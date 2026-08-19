import { Connection, Keypair } from '@solana/web3.js';
import type { Env } from '../env.js';
import type { MintInfo } from '../chain/mint.js';
import { associatedTokenAddress, buildTransferInstructions } from '../chain/transfer.js';
import { buildV0Transaction, confirmSignature, simulate, withComputeBudget } from '../chain/tx.js';
import type { PayoutRow, Repo } from '../db/repo.js';
import { errorMessage, log } from '../logger.js';
import { chunk, sleep } from '../util/async.js';

export interface DistributionResult {
  confirmed: number;
  failed: number;
  txCount: number;
  distributedRaw: bigint;
}

/**
 * Pays out every pending row for a cycle.
 *
 * Safety properties:
 *  - Rows are written to Supabase before anything is signed, so a restart
 *    resumes rather than repeats.
 *  - A row that already carries a signature is re-checked on chain before it
 *    is ever resent.
 *  - Batches are confirmed one at a time; a failure stops that batch only.
 */
export async function distribute(
  env: Env,
  connection: Connection,
  wallet: Keypair,
  rewardMint: MintInfo,
  repo: Repo,
  cycleId: string,
): Promise<DistributionResult> {
  const pending = await repo.pendingPayouts(cycleId, rewardMint.mint.toBase58());
  if (pending.length === 0) {
    return { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
  }

  const outstanding = await reconcileSentPayouts(connection, repo, pending);
  if (outstanding.length === 0) {
    return { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
  }

  if (env.DRY_RUN) {
    log.info('dry run: not sending payouts', {
      cycleId,
      mint: rewardMint.mint.toBase58(),
      payouts: outstanding.length,
    });
    await repo.markPayouts(
      outstanding.map((p) => p.id),
      { status: 'skipped', error: 'dry run' },
    );
    return { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
  }

  const source = associatedTokenAddress(rewardMint, wallet.publicKey);

  let confirmed = 0;
  let failed = 0;
  let txCount = 0;
  let distributedRaw = 0n;

  for (const batch of chunk(outstanding, env.TRANSFERS_PER_TX)) {
    const ids = batch.map((p) => p.id);
    const targets = batch.map((p) => ({ owner: p.owner, amountRaw: BigInt(p.amount_raw) }));
    const batchTotal = targets.reduce((sum, t) => sum + t.amountRaw, 0n);

    await repo.incrementAttempts(ids);

    try {
      const signature = await sendBatch(env, connection, wallet, rewardMint, source, targets);
      txCount += 1;
      await repo.markPayouts(ids, { status: 'sent', signature });
      await confirmSignature(connection, signature, env.CONFIRM_TIMEOUT_MS);
      await repo.markPayouts(ids, { status: 'confirmed', signature, error: null });
      confirmed += batch.length;
      distributedRaw += batchTotal;
      log.info('payout batch confirmed', {
        cycleId,
        mint: rewardMint.mint.toBase58(),
        signature,
        recipients: batch.length,
      });
    } catch (err) {
      failed += batch.length;
      const message = errorMessage(err).slice(0, 500);
      await repo.markPayouts(ids, { status: 'failed', error: message });
      await repo.logEvent('error', 'payout batch failed', { recipients: batch.length, error: message }, cycleId);
      log.error('payout batch failed', { cycleId, error: message });
    }

    // Be a good citizen towards the RPC between batches.
    await sleep(250);
  }

  return { confirmed, failed, txCount, distributedRaw };
}

/**
 * Rows left in 'sent' or 'failed' from an earlier run may already be on chain.
 * Confirm those before considering a resend.
 */
async function reconcileSentPayouts(
  connection: Connection,
  repo: Repo,
  rows: readonly PayoutRow[],
): Promise<PayoutRow[]> {
  const withSignature = rows.filter((r) => r.signature);
  if (withSignature.length === 0) return [...rows];

  const settled = new Set<number>();
  for (const group of chunk(withSignature, 100)) {
    const { value } = await connection.getSignatureStatuses(
      group.map((r) => r.signature!),
      { searchTransactionHistory: true },
    );
    const confirmedIds: number[] = [];
    value.forEach((status, index) => {
      const row = group[index]!;
      if (status && !status.err) {
        confirmedIds.push(row.id);
        settled.add(row.id);
      }
    });
    if (confirmedIds.length > 0) {
      await repo.markPayouts(confirmedIds, { status: 'confirmed', error: null });
      log.warn('recovered payouts that were already on chain', { count: confirmedIds.length });
    }
  }

  return rows.filter((r) => !settled.has(r.id));
}

async function sendBatch(
  env: Env,
  connection: Connection,
  wallet: Keypair,
  rewardMint: MintInfo,
  source: ReturnType<typeof associatedTokenAddress>,
  targets: Array<{ owner: string; amountRaw: bigint }>,
): Promise<string> {
  const instructions = await buildTransferInstructions(
    connection,
    rewardMint,
    source,
    wallet.publicKey,
    targets,
  );

  const { transaction } = await buildV0Transaction(
    connection,
    wallet.publicKey,
    withComputeBudget(instructions, env, 60_000 + targets.length * 45_000),
  );

  transaction.sign([wallet]);
  await simulate(connection, transaction);

  return connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
}

import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import type { Context, RewardToken } from '../context.js';
import {
  FailedTxError,
  RejectedTxError,
  ataOf,
  broadcast,
  buildSigned,
  confirm,
  formatSol,
  isValidAddress,
  priorityIxs,
} from '../chain/solana.js';
import type { PayoutRow } from '../db/repo.js';
import { errorMessage, log } from '../logger.js';
import { chunk } from '../util/async.js';

export interface DistributionResult {
  confirmed: number;
  failed: number;
  txCount: number;
  distributedRaw: bigint;
  note?: string;
}

/** Base fee per signature; the priority fee is added on top. */
const SIGNATURE_FEE_LAMPORTS = 5_000n;
/** Compute units a batch of idempotent-ATA + transferChecked pairs needs, per transfer. */
const CU_PER_TRANSFER = 40_000;

/**
 * Pays out open rows for one reward token, oldest first, up to
 * MAX_PAYOUTS_PER_CYCLE per run, PAYOUT_BATCH_SIZE transfers per transaction.
 * Each transfer creates the recipient's associated token account if needed
 * (ported from the memcoinz `airdrop` skill: idempotent ATA + transferChecked
 * with the mint's own token program, so Token-2022 mints work too).
 *
 * Ledger guarantees (Supabase `payouts`, keyed on cycle_id + owner + token):
 *  - Rows exist before anything is signed; a restart resumes them.
 *  - Each batch's signature and its last valid block height are written to
 *    the rows BEFORE the transaction is broadcast.
 *  - A row carrying a signature is looked up on chain before anything else
 *    happens to it: confirmed → marked paid; failed on chain → resent;
 *    unknown → resent only once its blockhash has expired (after that height
 *    the old transaction can never land), otherwise left for the next cycle.
 *    That is what makes a crash between broadcast and confirmation unable to
 *    pay anyone twice.
 */
export async function distribute(ctx: Context, reward: RewardToken, cycleId: string): Promise<DistributionResult> {
  const { env, repo } = ctx;
  const rows = await repo.pendingPayouts(reward.info.mint, env.MAX_PAYOUTS_PER_CYCLE);
  const result: DistributionResult = { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
  if (rows.length === 0) return result;

  if (env.DRY_RUN) {
    // Rows that already carry a signature came from a live run and may still
    // land: keep them for the next live reconcile instead of forgetting them.
    const unsigned = rows.filter((row) => !row.tx_id);
    log.info('dry run: not sending payouts', { symbol: reward.symbol, payouts: unsigned.length });
    await repo.markPayouts(
      unsigned.map((row) => row.id),
      { status: 'skipped', error: 'dry run' },
    );
    return result;
  }

  // --- 1. Settle anything that was signed in an earlier run ------------------
  const { sendable, recovered, inFlight } = await reconcile(ctx, rows);
  result.confirmed += recovered.length;
  result.distributedRaw += recovered.reduce((sum, row) => sum + BigInt(row.amount_raw), 0n);
  if (inFlight > 0) log.info('payouts still in flight, checking again next cycle', { symbol: reward.symbol, inFlight });

  // Bad addresses can only come from a manual DB edit; never let one block a batch.
  const todo: PayoutRow[] = [];
  for (const row of sendable) {
    if (isValidAddress(row.owner)) todo.push(row);
    else {
      await repo.markPayouts([row.id], { status: 'failed', error: 'not a valid Solana address' });
      result.failed += 1;
    }
  }
  if (todo.length === 0) return result;

  // --- 2. Pre-flight: can the treasury pay the fees and the new accounts? ---
  const shortfall = await checkSolBudget(ctx, reward, todo);
  if (shortfall) {
    result.note = `${reward.symbol}: ${shortfall}`;
    await repo.logEvent('warn', 'payouts postponed', { token: reward.info.mint, reason: shortfall }, cycleId);
    return result;
  }

  // --- 3. Send, batch by batch ----------------------------------------------
  const mint = new PublicKey(reward.info.mint);
  const payer = ctx.treasury.publicKey;
  const source = ataOf(reward.info, payer);

  for (const batch of chunk(todo, env.PAYOUT_BATCH_SIZE)) {
    const ids = batch.map((row) => row.id);
    const amount = batch.reduce((sum, row) => sum + BigInt(row.amount_raw), 0n);
    const ixs: TransactionInstruction[] = [...priorityIxs(env.PRIORITY_MICROLAMPORTS, CU_PER_TRANSFER * batch.length)];
    for (const row of batch) {
      const owner = new PublicKey(row.owner);
      const destination = ataOf(reward.info, owner);
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(payer, destination, owner, mint, reward.info.programId),
        createTransferCheckedInstruction(
          source,
          mint,
          destination,
          payer,
          BigInt(row.amount_raw),
          reward.info.decimals,
          [],
          reward.info.programId,
        ),
      );
    }

    let signature = '';
    try {
      const built = await buildSigned(ctx.conn, ixs, [ctx.treasury]);
      signature = built.signature;
      // The ledger learns the signature before the network does.
      await repo.markPayouts(ids, {
        status: 'sent',
        tx_id: built.signature,
        last_valid_height: built.lastValidBlockHeight,
        attempts: Math.max(...batch.map((row) => row.attempts)) + 1,
        error: null,
      });
      await broadcast(ctx.conn, built);
      result.txCount += 1;
      await confirm(ctx.conn, built);

      await repo.markPayouts(ids, { status: 'confirmed', error: null });
      result.confirmed += batch.length;
      result.distributedRaw += amount;
    } catch (err) {
      const message = errorMessage(err).slice(0, 400);
      result.failed += batch.length;
      const definitive = err instanceof RejectedTxError || err instanceof FailedTxError;
      if (definitive) {
        // Never landed, or landed and reverted: nothing moved, safe to resend.
        await repo
          .markPayouts(ids, { status: 'failed', tx_id: null, last_valid_height: null, error: message })
          .catch(() => undefined);
      } else if (signature) {
        // Outcome unknown (timeout, dropped connection). Keep the signature:
        // the next cycle's reconcile decides, so nobody can be paid twice.
        await repo.markPayouts(ids, { status: 'sent', error: message }).catch(() => undefined);
      }
      log.error('payout batch failed', { symbol: reward.symbol, recipients: batch.length, signature, error: message });
      await repo.logEvent(
        'error',
        'payout batch failed',
        { token: reward.info.mint, owners: batch.map((row) => row.owner), signature, error: message },
        cycleId,
      );
      // An RPC, balance or fee problem will hit every following batch too —
      // stop this token's run and let the next cycle resume.
      if (!definitive || /insufficient|custom program error: 0x1\b/i.test(message)) break;
    }
  }

  return result;
}

interface Reconciled {
  sendable: PayoutRow[];
  recovered: PayoutRow[];
  inFlight: number;
}

/** Looks every signed row up on chain before anything is resent. */
export async function reconcile(ctx: Context, rows: PayoutRow[]): Promise<Reconciled> {
  const signed = rows.filter((row) => row.tx_id);
  const out: Reconciled = { sendable: rows.filter((row) => !row.tx_id), recovered: [], inFlight: 0 };
  if (signed.length === 0) return out;

  const signatures = [...new Set(signed.map((row) => row.tx_id!))];
  const statuses = new Map<string, Awaited<ReturnType<typeof ctx.conn.getSignatureStatuses>>['value'][number]>();
  for (const batch of chunk(signatures, 256)) {
    const { value } = await ctx.conn.getSignatureStatuses(batch, { searchTransactionHistory: true });
    batch.forEach((signature, i) => statuses.set(signature, value[i] ?? null));
  }
  const height = await ctx.conn.getBlockHeight('confirmed');

  const bySignature = new Map<string, PayoutRow[]>();
  for (const row of signed) bySignature.set(row.tx_id!, [...(bySignature.get(row.tx_id!) ?? []), row]);

  for (const [signature, group] of bySignature) {
    const status = statuses.get(signature) ?? null;
    const ids = group.map((row) => row.id);
    const landed = status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized');

    if (landed && !status.err) {
      await ctx.repo.markPayouts(ids, { status: 'confirmed', error: null });
      out.recovered.push(...group);
      log.warn('recovered payouts that were already on chain', { signature, recipients: group.length });
    } else if (landed && status.err) {
      await ctx.repo.markPayouts(ids, {
        status: 'failed',
        tx_id: null,
        last_valid_height: null,
        error: `tx ${signature} failed on chain: ${JSON.stringify(status.err)}`,
      });
      out.sendable.push(...group.map((row) => ({ ...row, tx_id: null, last_valid_height: null })));
    } else if (!status && group[0]!.last_valid_height !== null && height > group[0]!.last_valid_height) {
      // Expired without landing: it can never land now.
      await ctx.repo.markPayouts(ids, { status: 'failed', tx_id: null, last_valid_height: null, error: `tx ${signature} expired` });
      out.sendable.push(...group.map((row) => ({ ...row, tx_id: null, last_valid_height: null })));
    } else {
      out.inFlight += group.length;
    }
  }
  return out;
}

/** Returns a reason string when the treasury cannot cover fees + new token accounts. */
async function checkSolBudget(ctx: Context, reward: RewardToken, todo: PayoutRow[]): Promise<string | null> {
  const { conn, env } = ctx;
  const destinations = todo.map((row) => ataOf(reward.info, new PublicKey(row.owner)));
  let missing = 0;
  for (const batch of chunk(destinations, 100)) {
    const infos = await conn.getMultipleAccountsInfo(batch, 'confirmed');
    missing += infos.filter((info) => !info).length;
  }
  const accountSize = reward.info.programId.equals(TOKEN_2022_PROGRAM_ID) ? 170 : 165;
  const rent = BigInt(await conn.getMinimumBalanceForRentExemption(accountSize));
  const txs = BigInt(Math.ceil(todo.length / env.PAYOUT_BATCH_SIZE));
  const priority = (BigInt(env.PRIORITY_MICROLAMPORTS) * BigInt(CU_PER_TRANSFER * env.PAYOUT_BATCH_SIZE)) / 1_000_000n;
  const needed = txs * (SIGNATURE_FEE_LAMPORTS + priority) + BigInt(missing) * rent;
  const balance = BigInt(await conn.getBalance(ctx.treasury.publicKey, 'confirmed'));
  if (balance >= needed) return null;
  return `treasury has ${formatSol(balance)} SOL, needs ~${formatSol(needed)} SOL for ${txs} txs and ${missing} new token accounts`;
}

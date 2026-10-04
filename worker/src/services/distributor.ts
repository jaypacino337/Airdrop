import type { Context, RewardToken } from '../context.js';
import { erc20 } from '../chain/evm.js';
import type { PayoutRow } from '../db/repo.js';
import { errorMessage, log } from '../logger.js';
import { sleep } from '../util/async.js';

export interface DistributionResult {
  confirmed: number;
  failed: number;
  txCount: number;
  distributedRaw: bigint;
}

/**
 * Pays out pending rows for one reward token, oldest first, up to
 * MAX_PAYOUTS_PER_CYCLE per run.
 *
 * Safety properties:
 *  - Rows exist in Supabase before anything is signed; a restart resumes.
 *  - A row already carrying a tx hash is checked against the chain before
 *    any resend, so a crash between send and confirm cannot double-pay.
 *  - Transfers go out sequentially, so nonces can never collide.
 */
export async function distribute(ctx: Context, reward: RewardToken, cycleId: string): Promise<DistributionResult> {
  const { env, repo, provider } = ctx;
  const rows = await repo.pendingPayouts(reward.info.address, env.MAX_PAYOUTS_PER_CYCLE);
  if (rows.length === 0) return { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };

  if (env.DRY_RUN) {
    log.info('dry run: not sending payouts', { symbol: reward.symbol, payouts: rows.length });
    for (const row of rows) await repo.markPayout(row.id, { status: 'skipped', error: 'dry run' });
    return { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
  }

  const token = erc20(env, reward.info.address);
  let confirmed = 0;
  let failed = 0;
  let txCount = 0;
  let distributedRaw = 0n;

  for (const row of rows) {
    try {
      const already = await reconcile(ctx, row);
      if (already) {
        confirmed += 1;
        distributedRaw += BigInt(row.amount_raw);
        continue;
      }

      await repo.markPayout(row.id, { status: 'pending', attempts: row.attempts + 1, error: null });
      const tx = await token.getFunction('transfer')(row.owner, BigInt(row.amount_raw));
      txCount += 1;
      await repo.markPayout(row.id, { status: 'sent', tx_hash: tx.hash });

      const receipt = await tx.wait(1, env.TX_TIMEOUT_MS);
      if (!receipt || receipt.status !== 1) throw new Error(`transfer ${tx.hash} reverted`);

      await repo.markPayout(row.id, { status: 'confirmed', tx_hash: tx.hash, error: null });
      confirmed += 1;
      distributedRaw += BigInt(row.amount_raw);
    } catch (err) {
      failed += 1;
      const message = errorMessage(err).slice(0, 400);
      await repo.markPayout(row.id, { status: 'failed', error: message }).catch(() => undefined);
      log.error('payout failed', { owner: row.owner, symbol: reward.symbol, error: message });
      await repo.logEvent('error', 'payout failed', { owner: row.owner, token: reward.info.address, error: message }, cycleId);
      // An RPC or gas problem will hit every following transfer too — stop
      // this token's run and let the next cycle resume.
      if (/insufficient funds|nonce|network|timeout/i.test(message)) break;
    }

    await sleep(150);
  }

  return { confirmed, failed, txCount, distributedRaw };
}

/** A row in `sent`/`failed` with a hash may already be on chain. */
async function reconcile(ctx: Context, row: PayoutRow): Promise<boolean> {
  if (!row.tx_hash) return false;
  try {
    const receipt = await ctx.provider.getTransactionReceipt(row.tx_hash);
    if (receipt && receipt.status === 1) {
      await ctx.repo.markPayout(row.id, { status: 'confirmed', tx_hash: row.tx_hash, error: null });
      log.warn('recovered payout that was already on chain', { owner: row.owner, hash: row.tx_hash });
      return true;
    }
  } catch {
    // Unknown hash — safe to resend, the nonce it used was either mined
    // (caught above) or replaced.
  }
  return false;
}

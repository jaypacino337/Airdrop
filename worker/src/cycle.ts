import type { Context } from './context.js';
import { allocate, type AllocationResult } from './core/allocate.js';
import { takeHolderSnapshot } from './chain/snapshot.js';
import { tokenBalance } from './chain/solana.js';
import { claimCreatorFees } from './services/fees.js';
import { buyRewardToken } from './services/swap.js';
import { distribute } from './services/distributor.js';
import { errorMessage, log } from './logger.js';
import { formatUi, toUi } from './util/amount.js';

export interface RewardSummary {
  symbol: string;
  token: string;
  weightBps: number;
  potRaw: string;
  distributedRaw: string;
  payoutCount: number;
  note?: string;
}

export interface CycleSummary {
  cycleId: string;
  status: 'completed' | 'failed' | 'skipped';
  /** Slot the holder snapshot was taken at. */
  chainHeight: number;
  feesClaimedRaw: string;
  holderCount: number;
  eligibleCount: number;
  cappedCount: number;
  txCount: number;
  rewards: RewardSummary[];
  note?: string;
  error?: string;
  durationMs: number;
}

let running = false;

export function isCycleRunning(): boolean {
  return running;
}

/**
 * One full pass: claim pump.fun creator fees -> optionally buy the reward
 * tokens with spendable SOL -> snapshot USTR holders -> read each pot ->
 * allocate under the 4% cap -> transfer.
 *
 * The snapshot and the eligibility maths are shared: every reward token is
 * distributed against the same holder set, so the only thing that differs per
 * token is the size of the pot.
 */
export async function runCycle(ctx: Context): Promise<CycleSummary> {
  if (running) throw new Error('a cycle is already running');
  running = true;

  const startedAt = Date.now();
  const { env, repo, conn, treasury, projectToken, rewards } = ctx;
  const cycleId = await repo.createCycle(env.DRY_RUN);
  const notes: string[] = [];

  try {
    log.info('cycle started', { cycleId, dryRun: env.DRY_RUN });

    // --- 1. Fee income: claim pump.fun creator fees into the treasury --------
    const claim = await claimCreatorFees(ctx);
    if (claim.reason && claim.status !== 'disabled') notes.push(`fees: ${claim.reason}`);
    await repo.updateCycle(cycleId, {
      fees_claimed_raw: claim.claimedRaw.toString(),
      claim_tx: claim.txId ?? null,
    });

    // --- 2. Optional buyback, splitting spendable SOL by weight ---------------
    const nativeBalance = BigInt(await conn.getBalance(treasury.publicKey, 'confirmed'));
    const reserve = BigInt(env.NATIVE_RESERVE_LAMPORTS);
    const spendable = nativeBalance > reserve ? nativeBalance - reserve : 0n;
    let nativeSpent = 0n;

    const buys = new Map<string, { nativeSpent: bigint; boughtRaw: bigint; txId?: string; note?: string }>();
    for (const reward of rewards) {
      const slice = (spendable * BigInt(reward.weightBps)) / 10_000n;
      const swap = await buyRewardToken(ctx, reward, slice);
      buys.set(reward.info.mint, {
        nativeSpent: swap.nativeSpent,
        boughtRaw: swap.boughtRaw,
        txId: swap.txId,
        note: swap.reason,
      });
      nativeSpent += swap.nativeSpent;
      if (swap.reason) notes.push(`${reward.symbol}: ${swap.reason}`);
    }

    await repo.updateCycle(cycleId, {
      native_spent_raw: nativeSpent.toString(),
      swap_provider: env.SWAP_PROVIDER === 'disabled' ? null : env.SWAP_PROVIDER,
    });

    // --- 3. Snapshot every USTR holder at this slot ---------------------------
    const snapshot = await takeHolderSnapshot(conn, {
      token: projectToken,
      heliusApiKey: env.HELIUS_API_KEY || undefined,
      excludePdas: env.EXCLUDE_CONTRACT_HOLDERS,
    });
    const holders = snapshot.holders;
    await repo.updateCycle(cycleId, { chain_height: snapshot.slot });

    log.info('holder snapshot taken', {
      cycleId,
      slot: snapshot.slot,
      source: snapshot.source,
      owners: snapshot.ownerCount,
      excludedPdas: snapshot.excludedCount,
    });

    // --- 4 + 5. Allocate and distribute, token by token ----------------------
    const summaries: RewardSummary[] = [];
    let txCount = 0;
    let snapshotSaved = false;
    let eligibleCount = 0;
    let cappedCount = 0;
    let anyFailure = false;
    let anyPayout = false;

    for (const reward of rewards) {
      // Rows staged in earlier cycles but not yet confirmed are already
      // promised; only what is left over is this cycle's pot.
      const balance = await tokenBalance(conn, reward.info, treasury.publicKey);
      const outstanding = await repo.outstandingRaw(reward.info.mint);
      const pot = balance > outstanding ? balance - outstanding : 0n;

      const result = allocate({
        potRaw: pot,
        holders,
        minBalanceRaw: ctx.minEligibleRaw,
        maxShareBps: env.MAX_WALLET_SHARE_BPS,
        minPayoutRaw: BigInt(env.MIN_PAYOUT_RAW),
        excluded: ctx.excluded,
      });

      eligibleCount = result.eligibleCount;
      cappedCount = Math.max(cappedCount, result.cappedCount);

      if (result.capRelaxed && !notes.some((n) => n.startsWith('cap relaxed'))) {
        notes.push(
          `cap relaxed: ${result.eligibleCount} eligible wallets cannot absorb a whole pot at ${env.MAX_WALLET_SHARE_BPS / 100}% each`,
        );
        await repo.logEvent('warn', 'per-wallet cap relaxed', { eligible: result.eligibleCount }, cycleId);
      }

      if (!snapshotSaved) {
        await saveSnapshot(ctx, cycleId, result);
        snapshotSaved = true;
      }

      if (result.allocations.length > 0 && pot > 0n) {
        await repo.stagePayouts(cycleId, reward.info.mint, reward.symbol, result.allocations);
      } else if (pot === 0n) {
        notes.push(`${reward.symbol}: nothing in the pot to distribute`);
      }

      // Always run: it also resumes rows left open by earlier cycles.
      const distributed = await distribute(ctx, reward, cycleId);
      anyPayout = anyPayout || distributed.confirmed > 0;
      anyFailure = anyFailure || distributed.failed > 0;
      if (distributed.note) notes.push(distributed.note);

      txCount += distributed.txCount;
      const buy = buys.get(reward.info.mint);

      summaries.push({
        symbol: reward.symbol,
        token: reward.info.mint,
        weightBps: reward.weightBps,
        potRaw: pot.toString(),
        distributedRaw: distributed.distributedRaw.toString(),
        payoutCount: distributed.confirmed,
        note: buy?.note,
      });

      await repo.upsertCycleReward(cycleId, reward.info.mint, {
        symbol: reward.symbol,
        weight_bps: reward.weightBps,
        decimals: reward.info.decimals,
        native_spent_raw: (buy?.nativeSpent ?? 0n).toString(),
        swap_tx: buy?.txId ?? null,
        bought_raw: (buy?.boughtRaw ?? 0n).toString(),
        pot_raw: pot.toString(),
        distributed_raw: distributed.distributedRaw.toString(),
        payout_count: distributed.confirmed,
        note: buy?.note ?? null,
      });

      log.info('reward distributed', {
        cycleId,
        symbol: reward.symbol,
        confirmed: distributed.confirmed,
        failed: distributed.failed,
        amount: formatUi(distributed.distributedRaw, reward.info.decimals, 6),
      });
    }

    if (!snapshotSaved) {
      const result = allocate({
        potRaw: 0n,
        holders,
        minBalanceRaw: ctx.minEligibleRaw,
        maxShareBps: env.MAX_WALLET_SHARE_BPS,
        excluded: ctx.excluded,
      });
      eligibleCount = result.eligibleCount;
      await saveSnapshot(ctx, cycleId, result);
    }

    const status = anyFailure && !anyPayout ? 'failed' : anyPayout ? 'completed' : 'skipped';

    await repo.updateCycle(cycleId, {
      status,
      finished_at: new Date().toISOString(),
      holder_count: holders.length,
      eligible_count: eligibleCount,
      capped_count: cappedCount,
      payout_count: summaries.reduce((sum, s) => sum + s.payoutCount, 0),
      tx_count: txCount,
      note: notes.join(' | ') || null,
      error: null,
    });

    const summary: CycleSummary = {
      cycleId,
      status,
      chainHeight: snapshot.slot,
      feesClaimedRaw: claim.claimedRaw.toString(),
      holderCount: holders.length,
      eligibleCount,
      cappedCount,
      txCount,
      rewards: summaries,
      note: notes.join(' | ') || undefined,
      durationMs: Date.now() - startedAt,
    };

    await repo.logEvent('info', 'cycle finished', { ...summary }, cycleId);
    log.info('cycle finished', summary);
    return summary;
  } catch (err) {
    const message = errorMessage(err);
    log.error('cycle failed', { cycleId, error: message });
    await repo
      .updateCycle(cycleId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: message.slice(0, 1000),
        note: notes.join(' | ') || null,
      })
      .catch(() => undefined);
    await repo.logEvent('error', 'cycle failed', { error: message }, cycleId).catch(() => undefined);

    return {
      cycleId,
      status: 'failed',
      chainHeight: 0,
      feesClaimedRaw: '0',
      holderCount: 0,
      eligibleCount: 0,
      cappedCount: 0,
      txCount: 0,
      rewards: [],
      error: message,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    running = false;
  }
}

async function saveSnapshot(ctx: Context, cycleId: string, result: AllocationResult): Promise<void> {
  const { env, repo, projectToken } = ctx;
  const allocationByOwner = new Map(result.allocations.map((a) => [a.owner, a]));
  const persisted =
    env.SNAPSHOT_PERSIST_LIMIT > 0 ? result.eligible.slice(0, env.SNAPSHOT_PERSIST_LIMIT) : result.eligible;

  await repo.saveSnapshot(
    cycleId,
    persisted.map((holder) => {
      const allocation = allocationByOwner.get(holder.owner);
      return {
        owner: holder.owner,
        balanceRaw: holder.balanceRaw,
        balanceUi: toUi(holder.balanceRaw, projectToken.decimals),
        shareBps: allocation?.shareBps ?? 0,
        capped: allocation?.capped ?? false,
      };
    }),
  );
}

import { PublicKey } from '@solana/web3.js';
import type { Context, RewardToken } from './context.js';
import { allocate, type AllocationResult } from './core/allocate.js';
import { snapshotHolders, type HolderRow } from './chain/holders.js';
import { associatedTokenAddress, getTokenBalanceRaw } from './chain/transfer.js';
import { claimCreatorFees } from './services/claim.js';
import { buyRewardToken } from './services/swap.js';
import { distribute } from './services/distributor.js';
import { errorMessage, log } from './logger.js';
import { formatUi, lamportsToSol, toUi } from './util/amount.js';

export interface RewardSummary {
  symbol: string;
  mint: string;
  weightBps: number;
  lamportsSpent: string;
  boughtRaw: string;
  distributedRaw: string;
  payoutCount: number;
  note?: string;
}

export interface CycleSummary {
  cycleId: string;
  status: 'completed' | 'failed' | 'skipped';
  claimedLamports: string;
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
 * One full pass: claim creator fees -> split the SOL across the reward tokens
 * -> buy each -> snapshot holders once -> allocate and transfer each token.
 *
 * The snapshot and the eligibility maths are shared: every reward token is
 * distributed against the same holder set, with the same 4% ceiling, so the
 * only thing that differs per token is the size of the pot.
 */
export async function runCycle(ctx: Context): Promise<CycleSummary> {
  if (running) throw new Error('a cycle is already running');
  running = true;

  const startedAt = Date.now();
  const { env, connection, wallet, repo, projectMint, rewards } = ctx;
  const cycleId = await repo.createCycle(env.DRY_RUN);
  const notes: string[] = [];

  try {
    log.info('cycle started', { cycleId, dryRun: env.DRY_RUN, rewards: rewards.map((r) => r.symbol) });

    // --- 1. Claim pump.fun creator fees --------------------------------------
    const claim = await claimCreatorFees(env, connection, wallet);
    if (claim.reason) notes.push(`claim: ${claim.reason}`);

    await repo.updateCycle(cycleId, {
      claim_signature: claim.signature ?? null,
      claimed_lamports: claim.claimedLamports.toString(),
    });

    // --- 2. Split the spendable SOL and buy each reward token -----------------
    const solBalance = BigInt(await connection.getBalance(wallet.publicKey, 'confirmed'));
    const reserve = BigInt(env.SOL_RESERVE_LAMPORTS);
    const spendable = solBalance > reserve ? solBalance - reserve : 0n;

    const buys = new Map<string, { lamports: bigint; boughtRaw: bigint; signature?: string; provider?: string; note?: string }>();
    let totalSpent = 0n;
    let swapProvider: string | null = null;

    for (const reward of rewards) {
      const lamportsFor = (spendable * BigInt(reward.weightBps)) / 10_000n;
      const swap = await buyRewardToken(env, connection, wallet, reward.mintInfo, lamportsFor);

      buys.set(reward.mint, {
        lamports: swap.lamportsSpent,
        boughtRaw: swap.boughtRaw,
        signature: swap.signature,
        provider: swap.provider,
        note: swap.reason,
      });
      totalSpent += swap.lamportsSpent;
      if (swap.provider) swapProvider = swap.provider;
      if (swap.reason) notes.push(`${reward.symbol}: ${swap.reason}`);

      await repo.upsertCycleReward(cycleId, reward.mint, {
        symbol: reward.symbol,
        weight_bps: reward.weightBps,
        decimals: reward.mintInfo.decimals,
        sol_spent_lamports: swap.lamportsSpent.toString(),
        swap_signature: swap.signature ?? null,
        swap_provider: swap.provider ?? null,
        bought_raw: swap.boughtRaw.toString(),
        note: swap.reason ?? null,
      });
    }

    await repo.updateCycle(cycleId, {
      sol_spent_lamports: totalSpent.toString(),
      swap_provider: swapProvider,
    });

    // --- 3. Snapshot holders once, for every token ---------------------------
    const holders = await snapshotHolders(env, connection, projectMint);
    const filtered = env.EXCLUDE_OFF_CURVE_OWNERS ? holders.filter((h) => isOnCurve(h.owner)) : holders;

    log.info('holder snapshot taken', {
      cycleId,
      holders: holders.length,
      afterProgramAccountFilter: filtered.length,
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
      const pot = await potFor(ctx, reward);
      const result = allocate({
        potRaw: pot,
        holders: filtered,
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

      // The share of each wallet is identical for every reward token — only the
      // pot differs — so the snapshot is written once.
      if (!snapshotSaved) {
        await saveSnapshot(ctx, cycleId, result);
        snapshotSaved = true;
      }

      log.info('allocation computed', {
        cycleId,
        symbol: reward.symbol,
        potRaw: pot.toString(),
        eligible: result.eligibleCount,
        capped: result.cappedCount,
        payouts: result.allocations.length,
        dust: result.dustRaw.toString(),
      });

      let distributed = { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
      if (result.allocations.length > 0) {
        await repo.stagePayouts(cycleId, reward.mint, reward.symbol, result.allocations);
        distributed = await distribute(env, connection, wallet, reward.mintInfo, repo, cycleId);
        anyPayout = anyPayout || distributed.confirmed > 0;
        anyFailure = anyFailure || distributed.failed > 0;
      } else if (pot === 0n) {
        notes.push(`${reward.symbol}: nothing in the pot to distribute`);
      }

      txCount += distributed.txCount;

      const buy = buys.get(reward.mint);
      summaries.push({
        symbol: reward.symbol,
        mint: reward.mint,
        weightBps: reward.weightBps,
        lamportsSpent: (buy?.lamports ?? 0n).toString(),
        boughtRaw: (buy?.boughtRaw ?? 0n).toString(),
        distributedRaw: distributed.distributedRaw.toString(),
        payoutCount: distributed.confirmed,
        note: buy?.note,
      });

      await repo.upsertCycleReward(cycleId, reward.mint, {
        symbol: reward.symbol,
        weight_bps: reward.weightBps,
        decimals: reward.mintInfo.decimals,
        sol_spent_lamports: (buy?.lamports ?? 0n).toString(),
        swap_signature: buy?.signature ?? null,
        swap_provider: buy?.provider ?? null,
        bought_raw: (buy?.boughtRaw ?? 0n).toString(),
        distributed_raw: distributed.distributedRaw.toString(),
        payout_count: distributed.confirmed,
        note: buy?.note ?? null,
      });

      log.info('reward distributed', {
        cycleId,
        symbol: reward.symbol,
        confirmed: distributed.confirmed,
        failed: distributed.failed,
        amount: formatUi(distributed.distributedRaw, reward.mintInfo.decimals, 6),
      });
    }

    if (!snapshotSaved) {
      // No reward token had a pot; still record who would have qualified.
      const result = allocate({
        potRaw: 0n,
        holders: filtered,
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
      holder_count: filtered.length,
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
      claimedLamports: claim.claimedLamports.toString(),
      holderCount: filtered.length,
      eligibleCount,
      cappedCount,
      txCount,
      rewards: summaries,
      note: notes.join(' | ') || undefined,
      durationMs: Date.now() - startedAt,
    };

    await repo.logEvent(
      'info',
      'cycle finished',
      { ...summary, claimedSol: lamportsToSol(claim.claimedLamports) },
      cycleId,
    );
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
      claimedLamports: '0',
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

/**
 * The pot is the distributor's entire balance of that token, not just this
 * cycle's purchase, so rounding dust and skipped payouts roll forward.
 */
async function potFor(ctx: Context, reward: RewardToken): Promise<bigint> {
  const ata = associatedTokenAddress(reward.mintInfo, ctx.wallet.publicKey);
  return getTokenBalanceRaw(ctx.connection, ata);
}

async function saveSnapshot(ctx: Context, cycleId: string, result: AllocationResult): Promise<void> {
  const { env, repo, projectMint } = ctx;
  const allocationByOwner = new Map(result.allocations.map((a) => [a.owner, a]));
  const persisted =
    env.SNAPSHOT_PERSIST_LIMIT > 0 ? result.eligible.slice(0, env.SNAPSHOT_PERSIST_LIMIT) : result.eligible;

  await repo.saveSnapshot(
    cycleId,
    persisted.map((holder: { owner: string; balanceRaw: bigint }) => {
      const allocation = allocationByOwner.get(holder.owner);
      return {
        owner: holder.owner,
        balanceRaw: holder.balanceRaw,
        balanceUi: toUi(holder.balanceRaw, projectMint.decimals),
        shareBps: allocation?.shareBps ?? 0,
        capped: allocation?.capped ?? false,
      };
    }),
  );
}

function isOnCurve(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export type { HolderRow };

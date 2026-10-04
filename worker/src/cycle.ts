import type { Context, RewardToken } from './context.js';
import { allocate, type AllocationResult } from './core/allocate.js';
import { updateHolderIndex } from './chain/indexer.js';
import { erc20 } from './chain/evm.js';
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
  blockNumber: number;
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
 * One full pass: update the holder index from Transfer logs -> optionally buy
 * the reward tokens -> read each pot -> allocate under the 4% cap -> transfer.
 *
 * The snapshot and the eligibility maths are shared: every reward token is
 * distributed against the same holder set, so the only thing that differs per
 * token is the size of the pot.
 */
export async function runCycle(ctx: Context): Promise<CycleSummary> {
  if (running) throw new Error('a cycle is already running');
  running = true;

  const startedAt = Date.now();
  const { env, repo, wallet, projectToken, rewards } = ctx;
  const cycleId = await repo.createCycle(env.DRY_RUN);
  const notes: string[] = [];

  try {
    log.info('cycle started', { cycleId, dryRun: env.DRY_RUN });

    // --- 1. Bring the holder index up to the chain head ----------------------
    const blockNumber = await updateHolderIndex(env, repo);
    await repo.updateCycle(cycleId, { block_number: blockNumber });

    // --- 2. Optional buyback, splitting spendable native by weight -----------
    const nativeBalance = await ctx.provider.getBalance(wallet.address);
    const reserve = BigInt(env.NATIVE_RESERVE_WEI);
    const spendable = nativeBalance > reserve ? nativeBalance - reserve : 0n;
    let nativeSpent = 0n;

    const buys = new Map<string, { weiSpent: bigint; boughtRaw: bigint; txHash?: string; note?: string }>();
    for (const reward of rewards) {
      const slice = (spendable * BigInt(reward.weightBps)) / 10_000n;
      const swap = await buyRewardToken(ctx, reward, slice);
      buys.set(reward.info.address, {
        weiSpent: swap.weiSpent,
        boughtRaw: swap.boughtRaw,
        txHash: swap.txHash,
        note: swap.reason,
      });
      nativeSpent += swap.weiSpent;
      if (swap.reason) notes.push(`${reward.symbol}: ${swap.reason}`);
    }

    await repo.updateCycle(cycleId, {
      native_spent_wei: nativeSpent.toString(),
      swap_provider: env.SWAP_PROVIDER === 'disabled' ? null : env.SWAP_PROVIDER,
    });

    // --- 3. Load holders and apply the exclusion rules ------------------------
    const holderRows = await repo.allHolders();
    const holders = holderRows
      .filter((row) => !(env.EXCLUDE_CONTRACT_HOLDERS && row.is_contract === true))
      .map((row) => ({ owner: row.address, balanceRaw: BigInt(String(row.balance_raw).split('.')[0] ?? '0') }));

    log.info('holder index loaded', { cycleId, holders: holderRows.length, afterContractFilter: holders.length });

    // --- 4 + 5. Allocate and distribute, token by token ----------------------
    const summaries: RewardSummary[] = [];
    let txCount = 0;
    let snapshotSaved = false;
    let eligibleCount = 0;
    let cappedCount = 0;
    let anyFailure = false;
    let anyPayout = false;

    for (const reward of rewards) {
      const pot = (await erc20(env, reward.info.address).getFunction('balanceOf')(wallet.address)) as bigint;

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

      let distributed = { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
      if (result.allocations.length > 0 && pot > 0n) {
        await repo.stagePayouts(cycleId, reward.info.address, reward.symbol, result.allocations);
        distributed = await distribute(ctx, reward, cycleId);
        anyPayout = anyPayout || distributed.confirmed > 0;
        anyFailure = anyFailure || distributed.failed > 0;
      } else if (pot === 0n) {
        notes.push(`${reward.symbol}: nothing in the pot to distribute`);
      }

      txCount += distributed.txCount;
      const buy = buys.get(reward.info.address);

      summaries.push({
        symbol: reward.symbol,
        token: reward.info.address,
        weightBps: reward.weightBps,
        potRaw: pot.toString(),
        distributedRaw: distributed.distributedRaw.toString(),
        payoutCount: distributed.confirmed,
        note: buy?.note,
      });

      await repo.upsertCycleReward(cycleId, reward.info.address, {
        symbol: reward.symbol,
        weight_bps: reward.weightBps,
        decimals: reward.info.decimals,
        native_spent_wei: (buy?.weiSpent ?? 0n).toString(),
        swap_tx: buy?.txHash ?? null,
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
      blockNumber,
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
      blockNumber: 0,
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

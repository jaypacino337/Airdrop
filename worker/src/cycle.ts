import { PublicKey } from '@solana/web3.js';
import type { Context } from './context.js';
import { allocate } from './core/allocate.js';
import { snapshotHolders } from './chain/holders.js';
import { associatedTokenAddress, getTokenBalanceRaw } from './chain/transfer.js';
import { claimCreatorFees } from './services/claim.js';
import { buyRewardToken } from './services/swap.js';
import { distribute } from './services/distributor.js';
import { errorMessage, log } from './logger.js';
import { formatUi, lamportsToSol, toUi } from './util/amount.js';

export interface CycleSummary {
  cycleId: string;
  status: 'completed' | 'failed' | 'skipped';
  claimedLamports: string;
  boughtRaw: string;
  distributedRaw: string;
  holderCount: number;
  eligibleCount: number;
  cappedCount: number;
  payoutCount: number;
  txCount: number;
  note?: string;
  error?: string;
  durationMs: number;
}

let running = false;

export function isCycleRunning(): boolean {
  return running;
}

/**
 * One full pass: claim creator fees -> buy MRNAx -> snapshot MRNA holders ->
 * allocate under the 4% cap -> transfer.
 *
 * Every leg is recorded in Supabase as it happens, so a crash leaves a
 * readable trail and the next run resumes rather than restarts.
 */
export async function runCycle(ctx: Context): Promise<CycleSummary> {
  if (running) throw new Error('a cycle is already running');
  running = true;

  const startedAt = Date.now();
  const { env, connection, wallet, repo, projectMint, rewardMint } = ctx;
  const cycleId = await repo.createCycle(env.DRY_RUN);
  const notes: string[] = [];

  try {
    log.info('cycle started', { cycleId, dryRun: env.DRY_RUN });

    // --- 1. Claim pump.fun creator fees --------------------------------------
    const balanceBefore = BigInt(await connection.getBalance(wallet.publicKey, 'confirmed'));
    let claim = { status: 'skipped' as const, claimedLamports: 0n, signature: undefined as string | undefined, reason: undefined as string | undefined };

    if (balanceBefore >= 0n) {
      const result = await claimCreatorFees(env, connection, wallet);
      claim = {
        status: result.status as 'skipped',
        claimedLamports: result.claimedLamports,
        signature: result.signature,
        reason: result.reason,
      };
      if (result.reason) notes.push(`claim: ${result.reason}`);
    }

    await repo.updateCycle(cycleId, {
      claim_signature: claim.signature ?? null,
      claimed_lamports: claim.claimedLamports.toString(),
    });

    // --- 2. Buy MRNAx with everything above the SOL reserve -------------------
    const solBalance = BigInt(await connection.getBalance(wallet.publicKey, 'confirmed'));
    const reserve = BigInt(env.SOL_RESERVE_LAMPORTS);
    const spendable = solBalance > reserve ? solBalance - reserve : 0n;

    const swap = await buyRewardToken(env, connection, wallet, rewardMint, spendable);
    if (swap.reason) notes.push(`swap: ${swap.reason}`);

    await repo.updateCycle(cycleId, {
      swap_signature: swap.signature ?? null,
      swap_provider: swap.provider ?? null,
      sol_spent_lamports: swap.lamportsSpent.toString(),
      reward_bought_raw: swap.boughtRaw.toString(),
    });

    // --- 3. The pot: everything the distributor currently holds ---------------
    // Using the balance (not just this cycle's purchase) means rounding dust
    // and any skipped payout rolls forward instead of being stranded.
    const rewardAta = associatedTokenAddress(rewardMint, wallet.publicKey);
    const potRaw = await getTokenBalanceRaw(connection, rewardAta);

    // --- 4. Snapshot MRNA holders --------------------------------------------
    const holders = await snapshotHolders(env, connection, projectMint);
    const filtered = env.EXCLUDE_OFF_CURVE_OWNERS
      ? holders.filter((h) => isOnCurve(h.owner))
      : holders;

    log.info('holder snapshot taken', {
      cycleId,
      holders: holders.length,
      afterProgramAccountFilter: filtered.length,
      potRaw: potRaw.toString(),
    });

    // --- 5. Allocate ----------------------------------------------------------
    const result = allocate({
      potRaw,
      holders: filtered,
      minBalanceRaw: ctx.minEligibleRaw,
      maxShareBps: env.MAX_WALLET_SHARE_BPS,
      minPayoutRaw: BigInt(env.MIN_PAYOUT_RAW),
      excluded: ctx.excluded,
    });

    if (result.capRelaxed) {
      notes.push(
        `per-wallet cap relaxed: ${result.eligibleCount} eligible wallets cannot absorb the pot at ${env.MAX_WALLET_SHARE_BPS / 100}% each`,
      );
      await repo.logEvent('warn', 'per-wallet cap relaxed', { eligible: result.eligibleCount }, cycleId);
    }

    log.info('allocation computed', {
      cycleId,
      eligible: result.eligibleCount,
      capped: result.cappedCount,
      payouts: result.allocations.length,
      allocated: result.allocatedRaw.toString(),
      dust: result.dustRaw.toString(),
    });

    // Persist the snapshot for the site. `payouts` is the complete record of
    // what was sent; this table is bounded so it cannot grow without limit.
    const allocationByOwner = new Map(result.allocations.map((a) => [a.owner, a]));
    const persisted = env.SNAPSHOT_PERSIST_LIMIT > 0
      ? result.eligible.slice(0, env.SNAPSHOT_PERSIST_LIMIT)
      : result.eligible;

    await repo.saveSnapshot(
      cycleId,
      persisted.map((holder) => {
        const allocation = allocationByOwner.get(holder.owner);
        return {
          owner: holder.owner,
          balanceRaw: holder.balanceRaw,
          balanceUi: toUi(holder.balanceRaw, projectMint.decimals),
          shareBps: allocation?.shareBps ?? 0,
          capped: allocation?.capped ?? false,
          allocationRaw: allocation?.amountRaw ?? 0n,
        };
      }),
    );

    // --- 6. Distribute --------------------------------------------------------
    let distributed = { confirmed: 0, failed: 0, txCount: 0, distributedRaw: 0n };
    if (result.allocations.length > 0) {
      await repo.stagePayouts(cycleId, result.allocations);
      distributed = await distribute(env, connection, wallet, rewardMint, repo, cycleId);
    } else {
      notes.push('nothing to distribute this cycle');
    }

    const status = distributed.failed > 0 && distributed.confirmed === 0 && result.allocations.length > 0
      ? 'failed'
      : result.allocations.length === 0
        ? 'skipped'
        : 'completed';

    await repo.updateCycle(cycleId, {
      status,
      finished_at: new Date().toISOString(),
      reward_distributed_raw: distributed.distributedRaw.toString(),
      holder_count: filtered.length,
      eligible_count: result.eligibleCount,
      capped_count: result.cappedCount,
      payout_count: distributed.confirmed,
      tx_count: distributed.txCount,
      note: notes.join(' | ') || null,
      error: null,
    });

    const summary: CycleSummary = {
      cycleId,
      status,
      claimedLamports: claim.claimedLamports.toString(),
      boughtRaw: swap.boughtRaw.toString(),
      distributedRaw: distributed.distributedRaw.toString(),
      holderCount: filtered.length,
      eligibleCount: result.eligibleCount,
      cappedCount: result.cappedCount,
      payoutCount: distributed.confirmed,
      txCount: distributed.txCount,
      note: notes.join(' | ') || undefined,
      durationMs: Date.now() - startedAt,
    };

    await repo.logEvent('info', 'cycle finished', {
      ...summary,
      claimedSol: lamportsToSol(claim.claimedLamports),
      distributedUi: formatUi(distributed.distributedRaw, rewardMint.decimals, 6),
    }, cycleId);

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
      boughtRaw: '0',
      distributedRaw: '0',
      holderCount: 0,
      eligibleCount: 0,
      cappedCount: 0,
      payoutCount: 0,
      txCount: 0,
      error: message,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    running = false;
  }
}

function isOnCurve(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

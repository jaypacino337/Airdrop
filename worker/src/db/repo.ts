import type { SupabaseClient } from '@supabase/supabase-js';
import type { Allocation } from '../core/allocate.js';
import { log } from '../logger.js';
import { chunk } from '../util/async.js';

export type CycleStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type PayoutStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped';

export interface CyclePatch {
  status?: CycleStatus;
  finished_at?: string;
  claim_signature?: string | null;
  claimed_lamports?: string;
  swap_provider?: string | null;
  sol_spent_lamports?: string;
  holder_count?: number;
  eligible_count?: number;
  capped_count?: number;
  payout_count?: number;
  tx_count?: number;
  note?: string | null;
  error?: string | null;
}

export interface PayoutRow {
  id: number;
  cycle_id: string;
  owner: string;
  mint: string;
  amount_raw: string;
  status: PayoutStatus;
  signature: string | null;
  attempts: number;
}

export interface CycleRewardPatch {
  symbol: string;
  weight_bps: number;
  decimals: number;
  sol_spent_lamports?: string;
  swap_signature?: string | null;
  swap_provider?: string | null;
  bought_raw?: string;
  distributed_raw?: string;
  payout_count?: number;
  note?: string | null;
}

const INSERT_CHUNK = 500;

export class Repo {
  constructor(private readonly db: SupabaseClient) {}

  async createCycle(dryRun: boolean): Promise<string> {
    const { data, error } = await this.db
      .from('cycles')
      .insert({ status: 'running', dry_run: dryRun })
      .select('id')
      .single();
    if (error) throw new Error(`createCycle failed: ${error.message}`);
    return data.id as string;
  }

  async updateCycle(cycleId: string, patch: CyclePatch): Promise<void> {
    const { error } = await this.db.from('cycles').update(patch).eq('id', cycleId);
    if (error) throw new Error(`updateCycle failed: ${error.message}`);
  }

  /** Upsert the per-reward-token row for a cycle. */
  async upsertCycleReward(cycleId: string, mint: string, patch: CycleRewardPatch): Promise<void> {
    const { error } = await this.db
      .from('cycle_rewards')
      .upsert({ cycle_id: cycleId, mint, ...patch }, { onConflict: 'cycle_id,mint' });
    if (error) throw new Error(`upsertCycleReward failed: ${error.message}`);
  }

  async saveSnapshot(
    cycleId: string,
    rows: Array<{ owner: string; balanceRaw: bigint; balanceUi: number; shareBps: number; capped: boolean }>,
  ): Promise<void> {
    for (const batch of chunk(rows, INSERT_CHUNK)) {
      const { error } = await this.db.from('snapshot_holders').upsert(
        batch.map((r) => ({
          cycle_id: cycleId,
          owner: r.owner,
          balance_raw: r.balanceRaw.toString(),
          balance_ui: r.balanceUi,
          share_bps: r.shareBps,
          capped: r.capped,
        })),
        { onConflict: 'cycle_id,owner' },
      );
      if (error) throw new Error(`saveSnapshot failed: ${error.message}`);
    }
  }

  /**
   * Writes one pending payout per allocation *before* anything is sent. The
   * (cycle_id, owner) unique key is the idempotency key: a worker that dies
   * mid-distribution resumes from these rows instead of paying twice.
   */
  async stagePayouts(
    cycleId: string,
    mint: string,
    symbol: string,
    allocations: readonly Allocation[],
  ): Promise<void> {
    for (const batch of chunk(allocations, INSERT_CHUNK)) {
      const { error } = await this.db.from('payouts').upsert(
        batch.map((a) => ({
          cycle_id: cycleId,
          owner: a.owner,
          mint,
          symbol,
          amount_raw: a.amountRaw.toString(),
          status: 'pending' as const,
        })),
        { onConflict: 'cycle_id,owner,mint', ignoreDuplicates: true },
      );
      if (error) throw new Error(`stagePayouts failed: ${error.message}`);
    }
  }

  async pendingPayouts(cycleId: string, mint: string): Promise<PayoutRow[]> {
    const { data, error } = await this.db
      .from('payouts')
      .select('id, cycle_id, owner, mint, amount_raw, status, signature, attempts')
      .eq('cycle_id', cycleId)
      .eq('mint', mint)
      .in('status', ['pending', 'failed'])
      .order('amount_raw', { ascending: false });
    if (error) throw new Error(`pendingPayouts failed: ${error.message}`);
    return (data ?? []) as PayoutRow[];
  }

  async markPayouts(
    ids: readonly number[],
    patch: { status: PayoutStatus; signature?: string | null; error?: string | null; attempts?: number },
  ): Promise<void> {
    if (ids.length === 0) return;
    const body: Record<string, unknown> = { ...patch };
    if (patch.status === 'confirmed') body.confirmed_at = new Date().toISOString();
    for (const batch of chunk(ids, INSERT_CHUNK)) {
      const { error } = await this.db.from('payouts').update(body).in('id', batch as number[]);
      if (error) throw new Error(`markPayouts failed: ${error.message}`);
    }
  }

  async incrementAttempts(ids: readonly number[]): Promise<void> {
    // Small volumes; a per-row update keeps this dependency-free.
    await Promise.all(
      ids.map(async (id) => {
        const { data } = await this.db.from('payouts').select('attempts').eq('id', id).single();
        const attempts = ((data?.attempts as number | undefined) ?? 0) + 1;
        await this.db.from('payouts').update({ attempts }).eq('id', id);
      }),
    );
  }

  async logEvent(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta: Record<string, unknown> = {},
    cycleId?: string,
  ): Promise<void> {
    const { error } = await this.db.from('events').insert({
      level,
      message,
      meta,
      ...(cycleId ? { cycle_id: cycleId } : {}),
    });
    // Never let telemetry break a cycle.
    if (error) log.warn('logEvent failed', { error: error.message });
  }

  async lastCycles(limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('cycles')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`lastCycles failed: ${error.message}`);
    return data ?? [];
  }

  async cycleById(cycleId: string): Promise<unknown | null> {
    const { data, error } = await this.db.from('cycles').select('*').eq('id', cycleId).maybeSingle();
    if (error) throw new Error(`cycleById failed: ${error.message}`);
    return data;
  }

  async stats(): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.from('airdrop_stats').select('*').maybeSingle();
    if (error) throw new Error(`stats failed: ${error.message}`);
    return (data ?? {}) as Record<string, unknown>;
  }

  async leaderboard(limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('leaderboard')
      .select('*')
      .order('total_received_raw', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`leaderboard failed: ${error.message}`);
    return data ?? [];
  }

  async walletHistory(owner: string, limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('payouts')
      .select('cycle_id, mint, symbol, amount_raw, status, signature, created_at, confirmed_at')
      .eq('owner', owner)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`walletHistory failed: ${error.message}`);
    return data ?? [];
  }

  async walletTotals(
    owner: string,
  ): Promise<Array<{ mint: string; symbol: string; total_received_raw: string; payout_count: number }>> {
    const { data, error } = await this.db
      .from('leaderboard')
      .select('mint, symbol, total_received_raw, payout_count')
      .eq('owner', owner);
    if (error) throw new Error(`walletTotals failed: ${error.message}`);
    return (data ?? []) as Array<{
      mint: string;
      symbol: string;
      total_received_raw: string;
      payout_count: number;
    }>;
  }

  async rewardTotals(): Promise<unknown[]> {
    const { data, error } = await this.db.from('reward_totals').select('*');
    if (error) throw new Error(`rewardTotals failed: ${error.message}`);
    return data ?? [];
  }

  async recentEvents(limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('events')
      .select('level, message, meta, created_at, cycle_id')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`recentEvents failed: ${error.message}`);
    return data ?? [];
  }
}

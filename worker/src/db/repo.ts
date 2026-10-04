import type { SupabaseClient } from '@supabase/supabase-js';
import type { Allocation } from '../core/allocate.js';
import { log } from '../logger.js';
import { chunk } from '../util/async.js';

export type CycleStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type PayoutStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped';

export interface CyclePatch {
  status?: CycleStatus;
  finished_at?: string;
  /** Slot the holder snapshot was taken at. */
  chain_height?: number;
  /** Lamports claimed from pump.fun creator fees this cycle. */
  fees_claimed_raw?: string;
  claim_tx?: string | null;
  /** Lamports spent buying reward tokens. */
  native_spent_raw?: string;
  swap_provider?: string | null;
  holder_count?: number;
  eligible_count?: number;
  capped_count?: number;
  payout_count?: number;
  tx_count?: number;
  note?: string | null;
  error?: string | null;
}

export interface CycleRewardPatch {
  symbol: string;
  weight_bps: number;
  decimals: number;
  native_spent_raw?: string;
  swap_tx?: string | null;
  bought_raw?: string;
  pot_raw?: string;
  distributed_raw?: string;
  payout_count?: number;
  note?: string | null;
}

export interface PayoutRow {
  id: number;
  cycle_id: string;
  owner: string;
  token: string;
  amount_raw: string;
  status: PayoutStatus;
  /** Transaction signature, written BEFORE the transaction is broadcast. */
  tx_id: string | null;
  /** Block height after which tx_id can no longer land (resend is then safe). */
  last_valid_height: number | null;
  attempts: number;
}

export interface PayoutPatch {
  status: PayoutStatus;
  tx_id?: string | null;
  last_valid_height?: number | null;
  error?: string | null;
  attempts?: number;
}

export interface SnapshotRow {
  owner: string;
  balanceRaw: bigint;
  balanceUi: number;
  shareBps: number;
  capped: boolean;
}

/**
 * Everything the engine reads and writes. SupabaseRepo is the production
 * ledger; tests and the localnet end-to-end run use an in-memory one.
 */
export interface LedgerRepo {
  createCycle(dryRun: boolean): Promise<string>;
  updateCycle(cycleId: string, patch: CyclePatch): Promise<void>;
  upsertCycleReward(cycleId: string, token: string, patch: CycleRewardPatch): Promise<void>;
  saveSnapshot(cycleId: string, rows: SnapshotRow[]): Promise<void>;
  stagePayouts(cycleId: string, token: string, symbol: string, allocations: readonly Allocation[]): Promise<void>;
  pendingPayouts(token: string, limit: number): Promise<PayoutRow[]>;
  /** Sum of every staged-but-unconfirmed payout of a token — already promised, not pot. */
  outstandingRaw(token: string): Promise<bigint>;
  markPayouts(ids: number[], patch: PayoutPatch): Promise<void>;
  logEvent(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>, cycleId?: string): Promise<void>;
  lastCycles(limit: number): Promise<unknown[]>;
  stats(): Promise<Record<string, unknown>>;
  rewardTotals(): Promise<unknown[]>;
  walletTotals(owner: string): Promise<Array<{ token: string; symbol: string; total_received_raw: string; payout_count: number }>>;
  walletHistory(owner: string, limit: number): Promise<unknown[]>;
}

const OPEN_STATUSES: PayoutStatus[] = ['pending', 'sent', 'failed'];

const CHUNK = 500;

export class SupabaseRepo implements LedgerRepo {
  constructor(private readonly db: SupabaseClient) {}

  // --- cycles ---------------------------------------------------------------

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

  async upsertCycleReward(cycleId: string, token: string, patch: CycleRewardPatch): Promise<void> {
    const { error } = await this.db
      .from('cycle_rewards')
      .upsert({ cycle_id: cycleId, token, ...patch }, { onConflict: 'cycle_id,token' });
    if (error) throw new Error(`upsertCycleReward failed: ${error.message}`);
  }

  // --- snapshots & payouts --------------------------------------------------

  async saveSnapshot(
    cycleId: string,
    rows: SnapshotRow[],
  ): Promise<void> {
    for (const batch of chunk(rows, CHUNK)) {
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
   * Writes one pending payout per allocation BEFORE anything is signed. The
   * (cycle_id, owner, token) unique key is the idempotency key that lets a
   * restarted engine resume instead of paying twice.
   */
  async stagePayouts(
    cycleId: string,
    token: string,
    symbol: string,
    allocations: readonly Allocation[],
  ): Promise<void> {
    for (const batch of chunk(allocations, CHUNK)) {
      const { error } = await this.db.from('payouts').upsert(
        batch.map((a) => ({
          cycle_id: cycleId,
          owner: a.owner,
          token,
          symbol,
          amount_raw: a.amountRaw.toString(),
          status: 'pending' as const,
        })),
        { onConflict: 'cycle_id,owner,token', ignoreDuplicates: true },
      );
      if (error) throw new Error(`stagePayouts failed: ${error.message}`);
    }
  }

  /** Unfinished payouts for a token across ALL cycles — resume-friendly. */
  async pendingPayouts(token: string, limit: number): Promise<PayoutRow[]> {
    const { data, error } = await this.db
      .from('payouts')
      // ::text keeps raw amounts above 2^53 exact through JSON.
      .select('id, cycle_id, owner, token, amount_raw::text, status, tx_id, last_valid_height, attempts')
      .eq('token', token)
      .in('status', OPEN_STATUSES)
      .order('id', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`pendingPayouts failed: ${error.message}`);
    return ((data ?? []) as Array<Omit<PayoutRow, 'last_valid_height'> & { last_valid_height: number | string | null }>).map(
      (row) => ({ ...row, last_valid_height: row.last_valid_height === null ? null : Number(row.last_valid_height) }),
    );
  }

  async outstandingRaw(token: string): Promise<bigint> {
    let total = 0n;
    const page = 1_000;
    for (let offset = 0; ; offset += page) {
      const { data, error } = await this.db
        .from('payouts')
        .select('amount_raw::text')
        .eq('token', token)
        .in('status', OPEN_STATUSES)
        .order('id', { ascending: true })
        .range(offset, offset + page - 1);
      if (error) throw new Error(`outstandingRaw failed: ${error.message}`);
      for (const row of (data ?? []) as Array<{ amount_raw: string }>) total += BigInt(row.amount_raw);
      if (!data || data.length < page) break;
    }
    return total;
  }

  async markPayouts(ids: number[], patch: PayoutPatch): Promise<void> {
    if (ids.length === 0) return;
    const body: Record<string, unknown> = { ...patch };
    if (patch.status === 'confirmed') body.confirmed_at = new Date().toISOString();
    for (const batch of chunk(ids, 200)) {
      const { error } = await this.db.from('payouts').update(body).in('id', batch);
      if (error) throw new Error(`markPayouts failed: ${error.message}`);
    }
  }

  // --- telemetry & reads ----------------------------------------------------

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
    if (error) log.warn('logEvent failed', { error: error.message });
  }

  async lastCycles(limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('cycles')
      .select('*, cycle_rewards(*)')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`lastCycles failed: ${error.message}`);
    return data ?? [];
  }

  async stats(): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.from('airdrop_stats').select('*').maybeSingle();
    if (error) throw new Error(`stats failed: ${error.message}`);
    return (data ?? {}) as Record<string, unknown>;
  }

  async rewardTotals(): Promise<unknown[]> {
    const { data, error } = await this.db.from('reward_totals').select('*');
    if (error) throw new Error(`rewardTotals failed: ${error.message}`);
    return data ?? [];
  }

  async walletTotals(
    owner: string,
  ): Promise<Array<{ token: string; symbol: string; total_received_raw: string; payout_count: number }>> {
    const { data, error } = await this.db
      .from('leaderboard')
      .select('token, symbol, total_received_raw::text, payout_count')
      .eq('owner', owner);
    if (error) throw new Error(`walletTotals failed: ${error.message}`);
    return (data ?? []) as Array<{ token: string; symbol: string; total_received_raw: string; payout_count: number }>;
  }

  async walletHistory(owner: string, limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('payouts')
      .select('cycle_id, token, symbol, amount_raw::text, status, tx_id, created_at, confirmed_at')
      .eq('owner', owner)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`walletHistory failed: ${error.message}`);
    return data ?? [];
  }
}

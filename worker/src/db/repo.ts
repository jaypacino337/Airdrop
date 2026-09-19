import type { SupabaseClient } from '@supabase/supabase-js';
import type { Allocation } from '../core/allocate.js';
import { log } from '../logger.js';
import { chunk } from '../util/async.js';

export type CycleStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type PayoutStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped';

export interface CyclePatch {
  status?: CycleStatus;
  finished_at?: string;
  block_number?: number;
  native_spent_wei?: string;
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
  native_spent_wei?: string;
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
  tx_hash: string | null;
  attempts: number;
}

export interface HolderRow {
  address: string;
  balance_raw: string;
  is_contract: boolean | null;
}

const CHUNK = 500;

export class Repo {
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

  // --- holder index ---------------------------------------------------------

  async indexerState(): Promise<{ token_address: string; last_block: number } | null> {
    const { data, error } = await this.db.from('indexer_state').select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(`indexerState failed: ${error.message}`);
    if (!data) return null;
    return { token_address: data.token_address as string, last_block: Number(data.last_block) };
  }

  async setIndexerState(token: string, lastBlock: number): Promise<void> {
    const { error } = await this.db
      .from('indexer_state')
      .upsert({ id: 1, token_address: token, last_block: lastBlock, updated_at: new Date().toISOString() });
    if (error) throw new Error(`setIndexerState failed: ${error.message}`);
  }

  async resetHolders(): Promise<void> {
    const { error } = await this.db.from('holders').delete().neq('address', '');
    if (error) throw new Error(`resetHolders failed: ${error.message}`);
  }

  /** Fold Transfer-log deltas into the stored balances. */
  async applyBalanceDeltas(deltas: Map<string, bigint>): Promise<void> {
    const addresses = [...deltas.keys()];
    const current = new Map<string, bigint>();

    for (const batch of chunk(addresses, 200)) {
      const { data, error } = await this.db
        .from('holders')
        .select('address, balance_raw')
        .in('address', batch);
      if (error) throw new Error(`applyBalanceDeltas read failed: ${error.message}`);
      for (const row of data ?? []) current.set(row.address as string, BigInt(String(row.balance_raw).split('.')[0] ?? '0'));
    }

    const upserts = addresses.map((address) => {
      let balance = (current.get(address) ?? 0n) + deltas.get(address)!;
      if (balance < 0n) {
        // Should be impossible with a complete log history; clamp and warn so
        // one bad row cannot make the whole cycle throw.
        log.warn('negative balance clamped to zero — index may need a rebuild', { address });
        balance = 0n;
      }
      return { address, balance_raw: balance.toString(), updated_at: new Date().toISOString() };
    });

    for (const batch of chunk(upserts, CHUNK)) {
      const { error } = await this.db.from('holders').upsert(batch, { onConflict: 'address' });
      if (error) throw new Error(`applyBalanceDeltas write failed: ${error.message}`);
    }
  }

  async holdersWithUnknownKind(limit: number): Promise<string[]> {
    const { data, error } = await this.db
      .from('holders')
      .select('address')
      .is('is_contract', null)
      .gt('balance_raw', 0)
      .order('balance_raw', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`holdersWithUnknownKind failed: ${error.message}`);
    return (data ?? []).map((row) => row.address as string);
  }

  async markHolderKind(address: string, isContract: boolean): Promise<void> {
    const { error } = await this.db.from('holders').update({ is_contract: isContract }).eq('address', address);
    if (error) throw new Error(`markHolderKind failed: ${error.message}`);
  }

  /** Every address with a positive balance, paginated out of PostgREST. */
  async allHolders(): Promise<HolderRow[]> {
    const rows: HolderRow[] = [];
    const page = 1_000;
    for (let offset = 0; ; offset += page) {
      const { data, error } = await this.db
        .from('holders')
        .select('address, balance_raw, is_contract')
        .gt('balance_raw', 0)
        .order('balance_raw', { ascending: false })
        .range(offset, offset + page - 1);
      if (error) throw new Error(`allHolders failed: ${error.message}`);
      rows.push(...((data ?? []) as HolderRow[]));
      if (!data || data.length < page) break;
    }
    return rows;
  }

  // --- snapshots & payouts --------------------------------------------------

  async saveSnapshot(
    cycleId: string,
    rows: Array<{ owner: string; balanceRaw: bigint; balanceUi: number; shareBps: number; capped: boolean }>,
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
      .select('id, cycle_id, owner, token, amount_raw, status, tx_hash, attempts')
      .eq('token', token)
      .in('status', ['pending', 'failed', 'sent'])
      .order('id', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`pendingPayouts failed: ${error.message}`);
    return (data ?? []) as PayoutRow[];
  }

  async markPayout(
    id: number,
    patch: { status: PayoutStatus; tx_hash?: string | null; error?: string | null; attempts?: number },
  ): Promise<void> {
    const body: Record<string, unknown> = { ...patch };
    if (patch.status === 'confirmed') body.confirmed_at = new Date().toISOString();
    const { error } = await this.db.from('payouts').update(body).eq('id', id);
    if (error) throw new Error(`markPayout failed: ${error.message}`);
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
      .select('token, symbol, total_received_raw, payout_count')
      .eq('owner', owner);
    if (error) throw new Error(`walletTotals failed: ${error.message}`);
    return (data ?? []) as Array<{ token: string; symbol: string; total_received_raw: string; payout_count: number }>;
  }

  async walletHistory(owner: string, limit: number): Promise<unknown[]> {
    const { data, error } = await this.db
      .from('payouts')
      .select('cycle_id, token, symbol, amount_raw, status, tx_hash, created_at, confirmed_at')
      .eq('owner', owner)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`walletHistory failed: ${error.message}`);
    return data ?? [];
  }
}

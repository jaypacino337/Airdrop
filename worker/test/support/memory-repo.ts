import { randomUUID } from 'node:crypto';
import type { Allocation } from '../../src/core/allocate.js';
import type {
  CyclePatch,
  CycleRewardPatch,
  LedgerRepo,
  PayoutPatch,
  PayoutRow,
  SnapshotRow,
} from '../../src/db/repo.js';

export interface StoredPayout extends PayoutRow {
  symbol: string;
  error: string | null;
}

/**
 * The Supabase ledger's semantics in memory: the same unique key on
 * (cycle_id, owner, token), ignore-duplicates staging and open-status
 * queries. `journal` records every write in order so tests can prove a
 * signature reached the ledger before it reached the network.
 */
export class MemoryRepo implements LedgerRepo {
  cycles = new Map<string, Record<string, unknown>>();
  cycleRewards = new Map<string, Record<string, unknown>>();
  snapshots = new Map<string, SnapshotRow[]>();
  payouts: StoredPayout[] = [];
  events: Array<{ level: string; message: string; meta: Record<string, unknown> }> = [];
  journal: string[] = [];
  private nextId = 1;

  async createCycle(dryRun: boolean): Promise<string> {
    const id = randomUUID();
    this.cycles.set(id, { id, status: 'running', dry_run: dryRun, started_at: new Date().toISOString() });
    return id;
  }

  async updateCycle(cycleId: string, patch: CyclePatch): Promise<void> {
    Object.assign(this.cycles.get(cycleId)!, patch);
  }

  async upsertCycleReward(cycleId: string, token: string, patch: CycleRewardPatch): Promise<void> {
    this.cycleRewards.set(`${cycleId}:${token}`, { cycle_id: cycleId, token, ...patch });
  }

  async saveSnapshot(cycleId: string, rows: SnapshotRow[]): Promise<void> {
    this.snapshots.set(cycleId, rows);
  }

  async stagePayouts(cycleId: string, token: string, symbol: string, allocations: readonly Allocation[]): Promise<void> {
    for (const a of allocations) {
      if (this.payouts.some((p) => p.cycle_id === cycleId && p.owner === a.owner && p.token === token)) continue;
      this.payouts.push({
        id: this.nextId++,
        cycle_id: cycleId,
        owner: a.owner,
        token,
        symbol,
        amount_raw: a.amountRaw.toString(),
        status: 'pending',
        tx_id: null,
        last_valid_height: null,
        attempts: 0,
        error: null,
      });
    }
  }

  /** Inserts a row directly, e.g. one left behind by a crashed run. */
  seed(row: Partial<StoredPayout> & Pick<StoredPayout, 'owner' | 'token' | 'amount_raw'>): StoredPayout {
    const stored: StoredPayout = {
      id: this.nextId++,
      cycle_id: 'earlier-cycle',
      symbol: 'RWD',
      status: 'pending',
      tx_id: null,
      last_valid_height: null,
      attempts: 0,
      error: null,
      ...row,
    };
    this.payouts.push(stored);
    return stored;
  }

  async pendingPayouts(token: string, limit: number): Promise<PayoutRow[]> {
    return this.payouts
      .filter((p) => p.token === token && ['pending', 'sent', 'failed'].includes(p.status))
      .sort((a, b) => a.id - b.id)
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async outstandingRaw(token: string): Promise<bigint> {
    return this.payouts
      .filter((p) => p.token === token && ['pending', 'sent', 'failed'].includes(p.status))
      .reduce((sum, p) => sum + BigInt(p.amount_raw), 0n);
  }

  async markPayouts(ids: number[], patch: PayoutPatch): Promise<void> {
    for (const id of ids) {
      const row = this.payouts.find((p) => p.id === id)!;
      Object.assign(row, patch);
      this.journal.push(`payout:${id}:${patch.status}${patch.tx_id ? `:${patch.tx_id}` : ''}`);
    }
  }

  async logEvent(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta: Record<string, unknown> = {}): Promise<void> {
    this.events.push({ level, message, meta });
  }

  async lastCycles(limit: number): Promise<unknown[]> {
    return [...this.cycles.values()].slice(-limit).reverse();
  }

  async stats(): Promise<Record<string, unknown>> {
    const confirmed = this.payouts.filter((p) => p.status === 'confirmed');
    return { total_payouts: confirmed.length, unique_recipients: new Set(confirmed.map((p) => p.owner)).size };
  }

  async rewardTotals(): Promise<unknown[]> {
    return [];
  }

  async walletTotals(owner: string) {
    const rows = this.payouts.filter((p) => p.owner === owner && p.status === 'confirmed');
    const byToken = new Map<string, { token: string; symbol: string; total_received_raw: string; payout_count: number }>();
    for (const row of rows) {
      const current = byToken.get(row.token) ?? { token: row.token, symbol: row.symbol, total_received_raw: '0', payout_count: 0 };
      current.total_received_raw = (BigInt(current.total_received_raw) + BigInt(row.amount_raw)).toString();
      current.payout_count += 1;
      byToken.set(row.token, current);
    }
    return [...byToken.values()];
  }

  async walletHistory(owner: string, limit: number): Promise<unknown[]> {
    return this.payouts.filter((p) => p.owner === owner).slice(-limit);
  }

  /** Confirmed amount paid to each owner for a token. */
  paidTo(token: string): Map<string, bigint> {
    const out = new Map<string, bigint>();
    for (const p of this.payouts) {
      if (p.token === token && p.status === 'confirmed') out.set(p.owner, (out.get(p.owner) ?? 0n) + BigInt(p.amount_raw));
    }
    return out;
  }
}

export interface Cycle {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  claim_signature: string | null;
  claimed_lamports: string;
  swap_signature: string | null;
  swap_provider: string | null;
  sol_spent_lamports: string;
  reward_bought_raw: string;
  reward_distributed_raw: string;
  holder_count: number;
  eligible_count: number;
  capped_count: number;
  payout_count: number;
  tx_count: number;
  note: string | null;
  error: string | null;
}

export interface SnapshotHolder {
  owner: string;
  balance_raw: string;
  balance_ui: number;
  share_bps: number;
  capped: boolean;
  allocation_raw: string;
}

export interface Payout {
  cycle_id: string;
  owner: string;
  amount_raw: string;
  status: string;
  signature: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface AirdropStats {
  completed_cycles: number;
  total_claimed_lamports: string;
  total_sol_spent_lamports: string;
  total_reward_bought_raw: string;
  total_reward_distributed_raw: string;
  total_payouts: number;
  unique_recipients: number;
  last_completed_at: string | null;
  last_eligible_count: number | null;
}

export interface StatsResponse {
  configured: boolean;
  stats: AirdropStats;
  lastCycle: Cycle | null;
  nextDropAt: string | null;
  warning?: string;
}

export interface HoldersResponse {
  cycleId: string | null;
  takenAt: string | null;
  eligibleCount: number;
  cappedCount: number;
  holders: SnapshotHolder[];
  warning?: string;
}

export interface WalletResponse {
  address: string;
  eligible: boolean;
  balanceUi: number;
  shareBps: number;
  capped: boolean;
  lastAllocationRaw: string;
  totalReceivedRaw: string;
  payoutCount: number;
  history: Payout[];
  warning?: string;
}

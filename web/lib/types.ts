export interface CycleReward {
  cycle_id: string;
  mint: string;
  symbol: string;
  weight_bps: number;
  sol_spent_lamports: string;
  swap_signature: string | null;
  swap_provider: string | null;
  bought_raw: string;
  distributed_raw: string;
  payout_count: number;
  decimals: number;
  note: string | null;
}

export interface Cycle {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  claim_signature: string | null;
  claimed_lamports: string;
  swap_provider: string | null;
  sol_spent_lamports: string;
  holder_count: number;
  eligible_count: number;
  capped_count: number;
  payout_count: number;
  tx_count: number;
  note: string | null;
  error: string | null;
  cycle_rewards?: CycleReward[];
}

export interface SnapshotHolder {
  owner: string;
  balance_raw: string;
  balance_ui: number;
  share_bps: number;
  capped: boolean;
}

export interface Payout {
  cycle_id: string;
  owner: string;
  mint: string;
  symbol: string;
  amount_raw: string;
  status: string;
  signature: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface RewardTotal {
  mint: string;
  symbol: string;
  distributed_raw: string;
  payout_count: number;
  recipient_count: number;
  last_payout_at: string | null;
}

export interface AirdropStats {
  completed_cycles: number;
  total_claimed_lamports: string;
  total_sol_spent_lamports: string;
  total_payouts: number;
  unique_recipients: number;
  last_completed_at: string | null;
  last_eligible_count: number | null;
}

export interface StatsResponse {
  configured: boolean;
  stats: AirdropStats;
  rewardTotals: RewardTotal[];
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

export interface WalletTotal {
  mint: string;
  symbol: string;
  totalReceivedRaw: string;
  payoutCount: number;
}

export interface WalletResponse {
  address: string;
  eligible: boolean;
  balanceUi: number;
  shareBps: number;
  capped: boolean;
  totals: WalletTotal[];
  history: Payout[];
  warning?: string;
}

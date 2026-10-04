export interface CycleReward {
  cycle_id: string;
  token: string;
  symbol: string;
  weight_bps: number;
  decimals: number;
  native_spent_wei: string;
  swap_tx: string | null;
  bought_raw: string;
  pot_raw: string;
  distributed_raw: string;
  payout_count: number;
  note: string | null;
}

export interface Cycle {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  block_number: number | null;
  native_spent_wei: string;
  swap_provider: string | null;
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
  token: string;
  symbol: string;
  amount_raw: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface RewardTotal {
  token: string;
  symbol: string;
  distributed_raw: string;
  payout_count: number;
  recipient_count: number;
  last_payout_at: string | null;
}

export interface AirdropStats {
  completed_cycles: number;
  total_native_spent_wei: string;
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
  token: string;
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

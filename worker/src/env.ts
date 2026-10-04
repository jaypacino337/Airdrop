import { z } from 'zod';

/**
 * Every knob the engine has, validated once at boot. A bad value fails loudly
 * here rather than half way through a cycle that has already moved funds.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v)));

const int = (def: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min));

const num = (def: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().min(min));

/** Comma-separated list. Solana addresses are case-sensitive, so values are kept as written. */
const list = () =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

/** A base58 Solana public key (32 bytes encode to 32–44 characters). */
export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const CLUSTERS = ['mainnet-beta', 'devnet', 'testnet', 'localnet'] as const;
export type Cluster = (typeof CLUSTERS)[number];

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: int(8080, 1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DRY_RUN: bool(true),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // The three below are only needed to run a cycle, not to boot. The engine
  // starts in standby without them so a fresh deploy comes up green and can
  // be configured afterwards. See readiness.ts.
  SOLANA_RPC_URL: z.string().default(''),
  TREASURY_SECRET_KEY: z.string().default(''),
  PROJECT_TOKEN_MINT: z.string().default(''),

  /** Optional: Helius key for the paginated getTokenAccounts holder scan. */
  HELIUS_API_KEY: z.string().default(''),
  /** Optional guard: refuse to start if the RPC's genesis hash is a different cluster. */
  SOLANA_CLUSTER: z.union([z.enum(CLUSTERS), z.literal('')]).default(''),

  /** SYMBOL:MINT:WEIGHT_BPS, comma separated. Weights must total 10000. */
  REWARD_TOKENS: z.string().default(''),

  CYCLE_INTERVAL_MS: int(300_000, 30_000),
  RUN_ON_BOOT: bool(true),

  MIN_ELIGIBLE_TOKENS: num(500_000),
  MAX_WALLET_SHARE_BPS: int(400, 1).pipe(z.number().max(10_000)),
  EXCLUDED_WALLETS: list(),
  /** Off-curve owners (PDAs: pools, bonding curves, lockers) never receive the airdrop. */
  EXCLUDE_CONTRACT_HOLDERS: bool(true),

  /** pumpfun: claim pump.fun creator fees into the treasury at the start of every cycle. */
  FEE_CLAIM: z.enum(['disabled', 'pumpfun']).default('pumpfun'),
  /** Claims smaller than this wait for a later cycle (0.01 SOL). */
  MIN_CLAIM_LAMPORTS: z.string().default('10000000'),

  SWAP_PROVIDER: z.enum(['disabled', 'pumpportal']).default('disabled'),
  /** PumpPortal pool: auto | pump | pump-amm | raydium | raydium-cpmm | launchlab | bonk. */
  SWAP_POOL: z.string().default('auto'),
  SWAP_SLIPPAGE_BPS: int(1_000, 1).pipe(z.number().max(5_000)),
  /** Priority fee PumpPortal adds to claim and buy transactions, in SOL. */
  PUMPPORTAL_PRIORITY_FEE_SOL: num(0.00005),
  /** SOL kept back for fees and recipient token-account rent. Default 0.05 SOL. */
  NATIVE_RESERVE_LAMPORTS: z.string().default('50000000'),
  MIN_SWAP_LAMPORTS: z.string().default('10000000'),

  MIN_PAYOUT_RAW: z.string().default('1'),
  SNAPSHOT_PERSIST_LIMIT: int(200, 0),
  /** Hard cap on payout rows sent per cycle; the rest resume next cycle. */
  MAX_PAYOUTS_PER_CYCLE: int(250, 1),
  /** Transfers per transaction. Each may also create the recipient's token account. */
  PAYOUT_BATCH_SIZE: int(4, 1).pipe(z.number().max(8)),
  /** Compute-unit price for payout transactions, in micro-lamports. */
  PRIORITY_MICROLAMPORTS: int(10_000, 0),

  ADMIN_TOKEN: z.string().default(''),
  CORS_ORIGINS: z.string().default('*'),
});

export interface RewardTokenConfig {
  symbol: string;
  /** Base58 SPL / Token-2022 mint address. */
  mint: string;
  /** Share of each cycle's buyback in basis points. */
  weightBps: number;
}

export type Env = z.infer<typeof schema> & {
  rewardTokens: RewardTokenConfig[];
};

/**
 * Parses `URANIUM:<MINT>:10000` or `A:<MINT>:5000,B:<MINT>:5000`.
 * The weights are how buyback funds split between the tokens each cycle.
 */
export function parseRewardTokens(raw: string): RewardTokenConfig[] {
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error('REWARD_TOKENS is empty — expected SYMBOL:MINT:WEIGHT_BPS entries');
  }

  const tokens = entries.map((entry) => {
    const [symbol, mint, weight] = entry.split(':').map((piece) => piece.trim());
    if (!symbol || !mint) {
      throw new Error(`REWARD_TOKENS entry "${entry}" must look like SYMBOL:MINT:WEIGHT_BPS`);
    }
    if (!SOLANA_ADDRESS.test(mint)) {
      throw new Error(`REWARD_TOKENS entry "${symbol}" does not carry a valid base58 mint address`);
    }
    const weightBps = weight === undefined || weight === '' ? NaN : Number(weight);
    if (!Number.isInteger(weightBps) || weightBps <= 0) {
      throw new Error(`REWARD_TOKENS entry "${symbol}" needs a positive integer weight in basis points`);
    }
    return { symbol, mint, weightBps };
  });

  const total = tokens.reduce((sum, token) => sum + token.weightBps, 0);
  if (total !== 10_000) {
    throw new Error(`REWARD_TOKENS weights add up to ${total} bps; they must total 10000 (100%)`);
  }

  const mints = new Set(tokens.map((t) => t.mint));
  if (mints.size !== tokens.length) throw new Error('REWARD_TOKENS lists the same token twice');

  return tokens;
}

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const env = parsed.data;

  // Parsed leniently here; readiness.ts turns a failure into a "not
  // configured yet" state rather than a crash at boot.
  let rewardTokens: RewardTokenConfig[] = [];
  if (env.REWARD_TOKENS.trim()) {
    try {
      rewardTokens = parseRewardTokens(env.REWARD_TOKENS);
    } catch {
      rewardTokens = []; // reported by checkReadiness()
    }
    if (rewardTokens.some((t) => t.mint === env.PROJECT_TOKEN_MINT.trim())) {
      throw new Error('A reward token cannot be the same mint as PROJECT_TOKEN_MINT.');
    }
  }

  for (const key of ['NATIVE_RESERVE_LAMPORTS', 'MIN_SWAP_LAMPORTS', 'MIN_CLAIM_LAMPORTS', 'MIN_PAYOUT_RAW'] as const) {
    if (!/^\d+$/.test(env[key])) throw new Error(`${key} must be a plain integer (raw units).`);
  }

  cached = { ...env, rewardTokens };
  return cached;
}

/** Test helper — drops the memoised env so a fresh one can be loaded. */
export function resetEnv(): void {
  cached = undefined;
}

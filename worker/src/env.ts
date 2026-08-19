import { z } from 'zod';

/**
 * Every knob the engine has, validated once at boot.
 * A bad or missing value fails loudly here rather than half way through a
 * cycle that has already moved funds.
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

export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: int(8080, 1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DRY_RUN: bool(true),

  HELIUS_API_KEY: z.string().default(''),
  RPC_URL: z.string().url().optional(),
  RPC_URL_FALLBACK: z.string().url().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // The three below are only needed to run a cycle, not to boot. The worker
  // starts in standby without them so a fresh deploy comes up green and can be
  // configured afterwards. See readiness.ts.
  CREATOR_PRIVATE_KEY: z.string().default(''),
  PROJECT_TOKEN_MINT: z.string().default(''),
  /** SYMBOL:MINT:WEIGHT_BPS, comma separated. Weights must total 10000. */
  REWARD_TOKENS: z.string().default(''),

  CYCLE_INTERVAL_MS: int(300_000, 30_000),
  RUN_ON_BOOT: bool(true),

  MIN_ELIGIBLE_TOKENS: num(500_000),
  MAX_WALLET_SHARE_BPS: int(400, 1).pipe(z.number().max(10_000)),
  EXCLUDED_WALLETS: list(),
  INCLUDE_FROZEN_ACCOUNTS: bool(false),
  EXCLUDE_OFF_CURVE_OWNERS: bool(true),

  CLAIM_PROVIDER: z.enum(['pumpportal', 'onchain', 'disabled']).default('pumpportal'),
  MIN_CLAIM_LAMPORTS: int(5_000_000),
  PUMPPORTAL_BASE_URL: z.string().url().default('https://pumpportal.fun'),

  SWAP_PROVIDER: z.enum(['auto', 'jupiter', 'pumpportal', 'disabled']).default('auto'),
  SWAP_SLIPPAGE_BPS: int(150, 1).pipe(z.number().max(5_000)),
  SOL_RESERVE_LAMPORTS: int(30_000_000),
  MIN_SWAP_LAMPORTS: int(5_000_000),
  JUPITER_BASE_URL: z.string().url().default('https://lite-api.jup.ag'),

  PRIORITY_FEE_MICROLAMPORTS: int(250_000),
  TRANSFERS_PER_TX: int(6, 1).pipe(z.number().max(12)),
  MAX_TX_ATTEMPTS: int(4, 1).pipe(z.number().max(10)),
  CONFIRM_TIMEOUT_MS: int(90_000, 5_000),
  MIN_PAYOUT_RAW: int(1, 0),
  SNAPSHOT_PERSIST_LIMIT: int(200, 0),

  ADMIN_TOKEN: z.string().default(''),
  CORS_ORIGINS: z.string().default('*'),
});

export interface RewardTokenConfig {
  symbol: string;
  mint: string;
  /** Share of each cycle's SOL spent on this token, in basis points. */
  weightBps: number;
}

export type Env = z.infer<typeof schema> & {
  rpcUrl: string;
  rpcUrlFallback: string | undefined;
  rewardTokens: RewardTokenConfig[];
};

/**
 * Parses `WLFI:mint:5000,TRUMP:mint:5000`.
 * The weights are how the claimed SOL is split between the tokens each cycle.
 */
export function parseRewardTokens(raw: string): RewardTokenConfig[] {
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (entries.length === 0) throw new Error('REWARD_TOKENS is empty — expected SYMBOL:MINT:WEIGHT_BPS entries');

  const tokens = entries.map((entry) => {
    const [symbol, mint, weight] = entry.split(':').map((piece) => piece.trim());
    if (!symbol || !mint) throw new Error(`REWARD_TOKENS entry "${entry}" must look like SYMBOL:MINT:WEIGHT_BPS`);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      throw new Error(`REWARD_TOKENS entry "${symbol}" does not carry a valid base58 mint`);
    }
    const weightBps = weight === undefined || weight === '' ? NaN : Number(weight);
    if (!Number.isInteger(weightBps) || weightBps <= 0) {
      throw new Error(`REWARD_TOKENS entry "${symbol}" needs a positive integer weight in basis points`);
    }
    return { symbol: symbol.toUpperCase(), mint, weightBps };
  });

  const total = tokens.reduce((sum, token) => sum + token.weightBps, 0);
  if (total !== 10_000) {
    throw new Error(`REWARD_TOKENS weights add up to ${total} bps; they must total 10000 (100%)`);
  }

  const mints = new Set(tokens.map((t) => t.mint));
  if (mints.size !== tokens.length) throw new Error('REWARD_TOKENS lists the same mint twice');

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

  const rpcUrl =
    env.RPC_URL ??
    (env.HELIUS_API_KEY ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : '');

  if (!rpcUrl) {
    throw new Error('Set HELIUS_API_KEY (or RPC_URL) — the worker needs a Solana RPC endpoint.');
  }

  // Reward tokens are parsed leniently here; readiness.ts turns a parse failure
  // into a "not configured yet" state rather than a crash at boot.
  let rewardTokens: RewardTokenConfig[] = [];
  if (env.REWARD_TOKENS.trim()) {
    rewardTokens = parseRewardTokens(env.REWARD_TOKENS);
    if (rewardTokens.some((token) => token.mint === env.PROJECT_TOKEN_MINT)) {
      throw new Error('A reward token cannot be the same mint as PROJECT_TOKEN_MINT.');
    }
  }

  cached = { ...env, rpcUrl, rpcUrlFallback: env.RPC_URL_FALLBACK, rewardTokens };
  return cached;
}

/** Test helper — drops the memoised env so a fresh one can be loaded. */
export function resetEnv(): void {
  cached = undefined;
}

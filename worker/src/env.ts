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

const list = () =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );

export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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
  EVM_RPC_URL: z.string().default(''),
  TREASURY_PRIVATE_KEY: z.string().default(''),
  PROJECT_TOKEN_ADDRESS: z.string().default(''),

  /** Block the USTR token was deployed at — where the holder index starts. */
  PROJECT_TOKEN_DEPLOY_BLOCK: int(0),
  /** Optional sanity check against the RPC's reported chain id. */
  CHAIN_ID: int(0),

  /** SYMBOL:0xADDRESS:WEIGHT_BPS, comma separated. Weights must total 10000. */
  REWARD_TOKENS: z.string().default(''),

  CYCLE_INTERVAL_MS: int(300_000, 30_000),
  RUN_ON_BOOT: bool(true),

  MIN_ELIGIBLE_TOKENS: num(500_000),
  MAX_WALLET_SHARE_BPS: int(400, 1).pipe(z.number().max(10_000)),
  EXCLUDED_WALLETS: list(),
  /** Contracts (pools, routers, lockers) never receive the airdrop. */
  EXCLUDE_CONTRACT_HOLDERS: bool(true),

  SWAP_PROVIDER: z.enum(['disabled', 'univ2']).default('disabled'),
  ROUTER_ADDRESS: z.string().default(''),
  WRAPPED_NATIVE_ADDRESS: z.string().default(''),
  SWAP_SLIPPAGE_BPS: int(300, 1).pipe(z.number().max(5_000)),
  /** Native kept back for gas. Default 0.02 (18 decimals). */
  NATIVE_RESERVE_WEI: z.string().default('20000000000000000'),
  MIN_SWAP_WEI: z.string().default('5000000000000000'),

  MIN_PAYOUT_RAW: z.string().default('1'),
  SNAPSHOT_PERSIST_LIMIT: int(200, 0),
  /** Hard cap on transfers sent per cycle; the rest resume next cycle. */
  MAX_PAYOUTS_PER_CYCLE: int(250, 1),
  TX_TIMEOUT_MS: int(120_000, 5_000),
  /** Blocks per eth_getLogs request while indexing holders. */
  LOG_SCAN_CHUNK: int(5_000, 100),

  ADMIN_TOKEN: z.string().default(''),
  CORS_ORIGINS: z.string().default('*'),
});

export interface RewardTokenConfig {
  symbol: string;
  /** Lowercase ERC-20 address. */
  token: string;
  /** Share of each cycle's buyback in basis points. */
  weightBps: number;
}

export type Env = z.infer<typeof schema> & {
  rewardTokens: RewardTokenConfig[];
};

/**
 * Parses `xU3O8:0x…:10000` or `XURA:0x…:5000,NNE:0x…:5000`.
 * The weights are how buyback funds split between the tokens each cycle.
 */
export function parseRewardTokens(raw: string): RewardTokenConfig[] {
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error('REWARD_TOKENS is empty — expected SYMBOL:0xADDRESS:WEIGHT_BPS entries');
  }

  const tokens = entries.map((entry) => {
    const [symbol, token, weight] = entry.split(':').map((piece) => piece.trim());
    if (!symbol || !token) {
      throw new Error(`REWARD_TOKENS entry "${entry}" must look like SYMBOL:0xADDRESS:WEIGHT_BPS`);
    }
    if (!EVM_ADDRESS.test(token)) {
      throw new Error(`REWARD_TOKENS entry "${symbol}" does not carry a valid 0x address`);
    }
    const weightBps = weight === undefined || weight === '' ? NaN : Number(weight);
    if (!Number.isInteger(weightBps) || weightBps <= 0) {
      throw new Error(`REWARD_TOKENS entry "${symbol}" needs a positive integer weight in basis points`);
    }
    return { symbol: symbol.toUpperCase() === 'XU3O8' ? 'xU3O8' : symbol, token: token.toLowerCase(), weightBps };
  });

  const total = tokens.reduce((sum, token) => sum + token.weightBps, 0);
  if (total !== 10_000) {
    throw new Error(`REWARD_TOKENS weights add up to ${total} bps; they must total 10000 (100%)`);
  }

  const addresses = new Set(tokens.map((t) => t.token));
  if (addresses.size !== tokens.length) throw new Error('REWARD_TOKENS lists the same token twice');

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
    rewardTokens = parseRewardTokens(env.REWARD_TOKENS);
    if (rewardTokens.some((t) => t.token === env.PROJECT_TOKEN_ADDRESS.toLowerCase())) {
      throw new Error('A reward token cannot be the same address as PROJECT_TOKEN_ADDRESS.');
    }
  }

  if (!/^\d+$/.test(env.NATIVE_RESERVE_WEI) || !/^\d+$/.test(env.MIN_SWAP_WEI) || !/^\d+$/.test(env.MIN_PAYOUT_RAW)) {
    throw new Error('NATIVE_RESERVE_WEI, MIN_SWAP_WEI and MIN_PAYOUT_RAW must be plain integers (raw units).');
  }

  cached = { ...env, rewardTokens };
  return cached;
}

/** Test helper — drops the memoised env so a fresh one can be loaded. */
export function resetEnv(): void {
  cached = undefined;
}

/**
 * Everything the browser is allowed to know. Values come from NEXT_PUBLIC_*
 * env vars at build time, with sane defaults so the site renders before the
 * engine is wired up.
 */

export interface RewardToken {
  symbol: string;
  token: string;
  decimals: number;
  /** Share of every cycle's buyback, in basis points. */
  weightBps: number;
}

const DEFAULT_REWARDS: RewardToken[] = [{ symbol: 'URANIUM', token: '', decimals: 6, weightBps: 10_000 }];

/** Parses `URANIUM:<mint>:6:10000`. Falls back to a single uranium token. */
function parseRewards(raw: string | undefined): RewardToken[] {
  if (!raw) return DEFAULT_REWARDS;
  const parsed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbol, token, decimals, weightBps] = entry.split(':').map((piece) => piece.trim());
      if (!symbol) return null;
      return {
        symbol,
        // Base58 mints are case-sensitive — keep them exactly as configured.
        token: token ?? '',
        decimals: Number(decimals ?? 6) || 0,
        weightBps: Number(weightBps ?? 0) || 0,
      };
    })
    .filter((token): token is RewardToken => token !== null);

  return parsed.length > 0 ? parsed : DEFAULT_REWARDS;
}

export const rewardTokens = parseRewards(process.env.NEXT_PUBLIC_REWARD_TOKENS);

export const siteConfig = {
  name: 'Uranium Strategy',
  ticker: process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? 'USTR',
  description:
    'Uranium Strategy routes its pump.fun creator fees into tokenized uranium exposure and airdrops it to USTR holders on Solana every five minutes. No claiming, no staking, no forms. Every distribution is on-chain.',
  /** The USTR mint (base58). */
  tokenAddress: (process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT ?? '').trim(),
  /** pump.fun mints have 6 decimals. */
  tokenDecimals: Number(process.env.NEXT_PUBLIC_PROJECT_TOKEN_DECIMALS ?? 6),
  treasuryAddress: (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '').trim(),
  /** mainnet-beta | devnet — only changes explorer links. */
  cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'mainnet-beta',
  cycleIntervalMs: Number(process.env.NEXT_PUBLIC_CYCLE_INTERVAL_MS ?? 300_000),
  minEligibleTokens: Number(process.env.NEXT_PUBLIC_MIN_ELIGIBLE_TOKENS ?? 500_000),
  maxWalletShareBps: Number(process.env.NEXT_PUBLIC_MAX_WALLET_SHARE_BPS ?? 400),
  /** Solana explorer base URL, no trailing slash. Solscan unless overridden. */
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://solscan.io').replace(/\/$/, ''),
  links: {
    twitter: process.env.NEXT_PUBLIC_TWITTER_URL ?? '',
    telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '',
    /** Where to buy. Defaults to the coin's pump.fun page once the mint is set. */
    pump:
      process.env.NEXT_PUBLIC_PUMP_URL ??
      (process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT ? `https://pump.fun/coin/${process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT.trim()}` : ''),
  },
} as const;

export const maxWalletSharePct = siteConfig.maxWalletShareBps / 100;
export const cycleMinutes = Math.max(1, Math.round(siteConfig.cycleIntervalMs / 60_000));

/** "URANIUM" or "URANIUM + USDC" — used all over the copy. */
export const rewardList = rewardTokens.map((token) => token.symbol).join(' + ');

export function decimalsFor(token: string, symbol?: string): number {
  return (
    rewardTokens.find((t) => t.token === token)?.decimals ??
    rewardTokens.find((t) => t.symbol.toUpperCase() === (symbol ?? '').toUpperCase())?.decimals ??
    6
  );
}

function explorer(path: string): string {
  if (!siteConfig.explorerUrl) return '';
  const cluster = siteConfig.cluster && siteConfig.cluster !== 'mainnet-beta' ? `?cluster=${siteConfig.cluster}` : '';
  return `${siteConfig.explorerUrl}/${path}${cluster}`;
}

export function explorerAddress(address: string): string {
  return explorer(`account/${address}`);
}

export function explorerToken(mint: string): string {
  return explorer(`token/${mint}`);
}

export function explorerTx(signature: string): string {
  return explorer(`tx/${signature}`);
}

/**
 * Everything the browser is allowed to know. Values come from NEXT_PUBLIC_*
 * env vars at build time, with sane defaults so the site renders before the
 * engine is wired up.
 */

export interface RewardToken {
  symbol: string;
  mint: string;
  decimals: number;
  /** Share of every cycle's buy, in basis points. */
  weightBps: number;
}

const DEFAULT_REWARDS: RewardToken[] = [
  { symbol: 'WLFI', mint: '', decimals: 6, weightBps: 5000 },
  { symbol: 'TRUMP', mint: '', decimals: 6, weightBps: 5000 },
];

/** Parses `WLFI:mint:6:5000,TRUMP:mint:6:5000`. Falls back to a 50/50 split. */
function parseRewards(raw: string | undefined): RewardToken[] {
  if (!raw) return DEFAULT_REWARDS;
  const parsed = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbol, mint, decimals, weightBps] = entry.split(':').map((piece) => piece.trim());
      if (!symbol) return null;
      return {
        symbol: symbol.toUpperCase(),
        mint: mint ?? '',
        decimals: Number(decimals ?? 6) || 0,
        weightBps: Number(weightBps ?? 0) || 0,
      };
    })
    .filter((token): token is RewardToken => token !== null);

  return parsed.length > 0 ? parsed : DEFAULT_REWARDS;
}

export const rewardTokens = parseRewards(process.env.NEXT_PUBLIC_REWARD_TOKENS);

export const siteConfig = {
  name: 'Trump Strategy',
  ticker: process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? 'STRATEGY',
  description:
    'Trump Strategy routes its pump.fun creator fees into WLFI and TRUMP — a 50/50 split — and airdrops both to holders every five minutes. No claiming, no staking, no forms.',
  tokenMint: process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT ?? '',
  tokenDecimals: Number(process.env.NEXT_PUBLIC_PROJECT_TOKEN_DECIMALS ?? 6),
  cycleIntervalMs: Number(process.env.NEXT_PUBLIC_CYCLE_INTERVAL_MS ?? 300_000),
  minEligibleTokens: Number(process.env.NEXT_PUBLIC_MIN_ELIGIBLE_TOKENS ?? 500_000),
  maxWalletShareBps: Number(process.env.NEXT_PUBLIC_MAX_WALLET_SHARE_BPS ?? 400),
  links: {
    twitter: process.env.NEXT_PUBLIC_TWITTER_URL ?? '',
    telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '',
    pumpfun: process.env.NEXT_PUBLIC_PUMPFUN_URL ?? '',
  },
} as const;

export const maxWalletSharePct = siteConfig.maxWalletShareBps / 100;
export const cycleMinutes = Math.max(1, Math.round(siteConfig.cycleIntervalMs / 60_000));

/** "WLFI + TRUMP" — used all over the copy. */
export const rewardList = rewardTokens.map((token) => token.symbol).join(' + ');

/** "50/50" — the split, written the way people say it. */
export const rewardSplit = rewardTokens.map((token) => Math.round(token.weightBps / 100)).join('/');

export function rewardBySymbolOrMint(key: string): RewardToken | undefined {
  return rewardTokens.find((token) => token.mint === key || token.symbol === key.toUpperCase());
}

export function decimalsFor(mint: string, symbol?: string): number {
  return rewardTokens.find((t) => t.mint === mint)?.decimals
    ?? rewardTokens.find((t) => t.symbol === (symbol ?? '').toUpperCase())?.decimals
    ?? 6;
}

export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}`;
}

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

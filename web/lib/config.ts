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

const DEFAULT_REWARDS: RewardToken[] = [{ symbol: 'xU3O8', token: '', decimals: 18, weightBps: 10_000 }];

/** Parses `xU3O8:0x…:18:10000`. Falls back to a single uranium token. */
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
        symbol: symbol.toUpperCase() === 'XU3O8' ? 'xU3O8' : symbol,
        token: (token ?? '').toLowerCase(),
        decimals: Number(decimals ?? 18) || 0,
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
    'Uranium Strategy routes its Pons creator fees into tokenized uranium exposure and airdrops it to USTR holders every five minutes. No claiming, no staking, no forms. Every distribution is on-chain.',
  tokenAddress: (process.env.NEXT_PUBLIC_PROJECT_TOKEN_ADDRESS ?? '').toLowerCase(),
  tokenDecimals: Number(process.env.NEXT_PUBLIC_PROJECT_TOKEN_DECIMALS ?? 18),
  treasuryAddress: (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '').toLowerCase(),
  cycleIntervalMs: Number(process.env.NEXT_PUBLIC_CYCLE_INTERVAL_MS ?? 300_000),
  minEligibleTokens: Number(process.env.NEXT_PUBLIC_MIN_ELIGIBLE_TOKENS ?? 500_000),
  maxWalletShareBps: Number(process.env.NEXT_PUBLIC_MAX_WALLET_SHARE_BPS ?? 400),
  /** Block-explorer base URL for the chain, no trailing slash. */
  explorerUrl: (process.env.NEXT_PUBLIC_EXPLORER_URL ?? '').replace(/\/$/, ''),
  links: {
    twitter: process.env.NEXT_PUBLIC_TWITTER_URL ?? '',
    telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? '',
    pons: process.env.NEXT_PUBLIC_PONS_URL ?? '',
  },
} as const;

export const maxWalletSharePct = siteConfig.maxWalletShareBps / 100;
export const cycleMinutes = Math.max(1, Math.round(siteConfig.cycleIntervalMs / 60_000));

/** "xU3O8" or "xU3O8 + NNE" — used all over the copy. */
export const rewardList = rewardTokens.map((token) => token.symbol).join(' + ');

export function decimalsFor(token: string, symbol?: string): number {
  return (
    rewardTokens.find((t) => t.token === token.toLowerCase())?.decimals ??
    rewardTokens.find((t) => t.symbol.toUpperCase() === (symbol ?? '').toUpperCase())?.decimals ??
    18
  );
}

export function explorerAddress(address: string): string {
  return siteConfig.explorerUrl ? `${siteConfig.explorerUrl}/address/${address}` : '';
}

export function explorerToken(address: string): string {
  return siteConfig.explorerUrl ? `${siteConfig.explorerUrl}/token/${address}` : '';
}

export function explorerTx(hash: string): string {
  return siteConfig.explorerUrl ? `${siteConfig.explorerUrl}/tx/${hash}` : '';
}

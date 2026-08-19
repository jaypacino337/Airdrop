/**
 * Everything the browser is allowed to know. Values come from NEXT_PUBLIC_*
 * env vars at build time, with sane defaults so the site renders before the
 * engine is wired up.
 */
export const siteConfig = {
  name: 'Moderna',
  ticker: process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? 'MRNA',
  rewardTicker: process.env.NEXT_PUBLIC_REWARD_SYMBOL ?? 'MRNAx',
  tagline: 'Hold MRNA. Get paid in MRNAx. Every five minutes.',
  description:
    'Moderna routes its pump.fun creator fees into MRNAx — tokenised Moderna stock — and airdrops it to MRNA holders every five minutes. No claiming, no staking, no forms.',
  tokenMint: process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT ?? '',
  rewardMint: process.env.NEXT_PUBLIC_REWARD_TOKEN_MINT ?? '',
  tokenDecimals: Number(process.env.NEXT_PUBLIC_PROJECT_TOKEN_DECIMALS ?? 6),
  rewardDecimals: Number(process.env.NEXT_PUBLIC_REWARD_TOKEN_DECIMALS ?? 8),
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

export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}`;
}

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

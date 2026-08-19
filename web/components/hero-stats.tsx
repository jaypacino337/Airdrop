'use client';

import { decimalsFor, rewardTokens } from '@/lib/config';
import { formatRaw, formatSol } from '@/lib/format';
import { useLiveStats } from '@/lib/use-live-stats';

/** Headline numbers under the hero: one per reward token, plus fees recycled. */
export function HeroStats() {
  const { data, loading } = useLiveStats();

  const byMint = new Map(data.rewardTotals.map((total) => [total.symbol.toUpperCase(), total]));

  const cells = [
    ...rewardTokens.map((token) => {
      const total = byMint.get(token.symbol);
      return {
        label: `${token.symbol} distributed`,
        value: formatRaw(total?.distributed_raw ?? '0', decimalsFor(token.mint, token.symbol), 2),
      };
    }),
    {
      label: 'Creator fees recycled',
      value: `${formatSol(data.stats.total_claimed_lamports)} SOL`,
    },
  ];

  return (
    <dl className="fade-up mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="card-raise rounded-lg border border-border bg-card px-4 py-5 text-center"
        >
          <dd
            className="tnum text-2xl font-semibold tracking-tight text-brand"
            aria-busy={loading || undefined}
          >
            {cell.value}
          </dd>
          <dt className="mt-1 text-xs text-muted-foreground">{cell.label}</dt>
        </div>
      ))}
    </dl>
  );
}

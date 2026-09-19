'use client';

import { decimalsFor, rewardTokens } from '@/lib/config';
import { formatNumber, formatRaw } from '@/lib/format';
import { useLiveStats } from '@/lib/use-live-stats';

/** The instrument row under the hero, refreshed on a poll. */
export function HeroStats() {
  const { data, loading } = useLiveStats();

  const byToken = new Map(data.rewardTotals.map((total) => [total.symbol.toUpperCase(), total]));

  const cells = [
    ...rewardTokens.map((token) => {
      const total = byToken.get(token.symbol.toUpperCase());
      return {
        label: `${token.symbol} dropped`,
        value: formatRaw(total?.distributed_raw ?? '0', decimalsFor(token.token, token.symbol), 4),
      };
    }),
    { label: 'Distributions', value: formatNumber(data.stats.completed_cycles) },
    { label: 'Wallets paid', value: formatNumber(data.stats.unique_recipients) },
  ];

  return (
    <dl className="fade-up mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
      {cells.slice(0, 3).map((cell) => (
        <div key={cell.label} className="panel rounded-md px-4 py-5 text-center">
          <dd
            className="tnum font-mono text-2xl font-bold tracking-tight text-brand"
            aria-busy={loading || undefined}
          >
            {cell.value}
          </dd>
          <dt className="readout mt-2">{cell.label}</dt>
        </div>
      ))}
    </dl>
  );
}

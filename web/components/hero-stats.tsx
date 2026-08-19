'use client';

import { siteConfig } from '@/lib/config';
import { formatNumber, formatRaw, formatSol } from '@/lib/format';
import { useLiveStats } from '@/lib/use-live-stats';

/** The three headline numbers under the hero, refreshed on a poll. */
export function HeroStats() {
  const { data, loading } = useLiveStats();
  const stats = data.stats;

  const cells = [
    {
      label: `${siteConfig.rewardTicker} distributed`,
      value: formatRaw(stats.total_reward_distributed_raw, siteConfig.rewardDecimals, 4),
    },
    {
      label: 'Fees recycled',
      value: `${formatSol(stats.total_claimed_lamports)} SOL`,
    },
    {
      label: 'Distributions completed',
      value: formatNumber(stats.completed_cycles),
    },
  ];

  return (
    <dl className="fade-up mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="rounded-lg border border-border bg-surface/50 px-4 py-5 text-center"
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

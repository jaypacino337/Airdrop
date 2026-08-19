'use client';

import { cycleMinutes, maxWalletSharePct, siteConfig } from '@/lib/config';
import { formatNumber, formatRaw, timeAgo } from '@/lib/format';
import { useLiveStats } from '@/lib/use-live-stats';

/** A hairline band of protocol constants and live counters. */
export function StatsBand() {
  const { data } = useLiveStats(30_000);

  const cells = [
    { value: `${cycleMinutes}m`, label: 'Between distributions' },
    { value: `${maxWalletSharePct}%`, label: 'Maximum share per wallet' },
    {
      value: formatNumber(siteConfig.minEligibleTokens),
      label: `${siteConfig.ticker} to qualify`,
    },
    {
      value: formatNumber(data.stats.unique_recipients),
      label: 'Wallets paid so far',
    },
  ];

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="hairline-grid grid grid-cols-2 overflow-hidden rounded-xl md:grid-cols-4">
          {cells.map((cell) => (
            <div key={cell.label} className="flex flex-col gap-1.5 bg-background p-8 md:p-10">
              <span className="tnum text-4xl font-semibold tracking-tight text-brand">
                {cell.value}
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{cell.label}</span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Last completed distribution {timeAgo(data.stats.last_completed_at)} ·{' '}
          {formatRaw(data.stats.total_reward_distributed_raw, siteConfig.rewardDecimals, 4)}{' '}
          {siteConfig.rewardTicker} sent in total
        </p>
      </div>
    </section>
  );
}

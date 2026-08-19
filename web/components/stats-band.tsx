'use client';

import { cycleMinutes, maxWalletSharePct, rewardList, rewardSplit, siteConfig } from '@/lib/config';
import { decimalsFor } from '@/lib/config';
import { formatNumber, formatRaw, timeAgo } from '@/lib/format';
import { useLiveStats } from '@/lib/use-live-stats';

/** A hairline band of protocol constants and live counters. */
export function StatsBand() {
  const { data } = useLiveStats(30_000);

  const cells = [
    { value: `${cycleMinutes}m`, label: 'Between distributions' },
    { value: rewardSplit, label: `Split between ${rewardList}` },
    { value: `${maxWalletSharePct}%`, label: 'Maximum share per wallet' },
    {
      value: formatNumber(siteConfig.minEligibleTokens),
      label: `${siteConfig.ticker} to qualify`,
    },
  ];

  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="hairline-grid card-raise grid grid-cols-2 overflow-hidden rounded-xl border border-border md:grid-cols-4">
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
          {formatNumber(data.stats.unique_recipients)} wallets paid ·{' '}
          {data.rewardTotals
            .map((total) => `${formatRaw(total.distributed_raw, decimalsFor(total.mint, total.symbol), 2)} ${total.symbol}`)
            .join(' + ') || 'no distributions yet'}
        </p>
      </div>
    </section>
  );
}

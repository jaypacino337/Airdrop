'use client';

import { cycleMinutes, maxWalletSharePct, rewardList, siteConfig, decimalsFor } from '@/lib/config';
import { formatNumber, formatRaw, timeAgo } from '@/lib/format';
import { useLiveStats } from '@/lib/use-live-stats';

/** A hairline band of protocol constants and live counters. */
export function StatsBand() {
  const { data } = useLiveStats(30_000);

  const cells = [
    { value: `${cycleMinutes}M`, label: 'Between distributions' },
    { value: rewardList, label: 'What gets dropped' },
    { value: `${maxWalletSharePct}%`, label: 'Maximum share per wallet' },
    { value: formatNumber(siteConfig.minEligibleTokens), label: `${siteConfig.ticker} to qualify` },
  ];

  return (
    <section className="border-t border-border">
      <div aria-hidden className="hazard" />
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="hairline-grid grid grid-cols-2 overflow-hidden rounded-md border border-border md:grid-cols-4">
          {cells.map((cell) => (
            <div key={cell.label} className="flex flex-col gap-2 bg-card p-8 md:p-10">
              <span className="tnum font-mono text-3xl font-bold tracking-tight text-brand md:text-4xl">
                {cell.value}
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{cell.label}</span>
            </div>
          ))}
        </div>

        <p className="readout mt-6 text-center">
          Last distribution {timeAgo(data.stats.last_completed_at)} ·{' '}
          {data.rewardTotals
            .map(
              (total) =>
                `${formatRaw(total.distributed_raw, decimalsFor(total.token, total.symbol), 2)} ${total.symbol}`,
            )
            .join(' + ') || 'no distributions yet'}{' '}
          · {formatNumber(data.stats.unique_recipients)} wallets paid
        </p>
      </div>
    </section>
  );
}

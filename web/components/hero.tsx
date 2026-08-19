import Link from 'next/link';
import { ArrowRight, Activity } from 'lucide-react';
import { NextDrop } from '@/components/next-drop';
import { HeroStats } from '@/components/hero-stats';
import { cycleMinutes, maxWalletSharePct, rewardList, rewardSplit, siteConfig } from '@/lib/config';
import { formatNumber } from '@/lib/format';

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="brand-glow pointer-events-none absolute left-1/2 top-0 h-[560px] w-[840px] -translate-x-1/2 -translate-y-1/3 rounded-full"
      />

      <div className="relative mx-auto max-w-5xl px-6 text-center">
        <div className="fade-up mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-xs font-medium text-muted-foreground">
            Live · next drop in <NextDrop />
          </span>
        </div>

        <h1 className="fade-up text-balance text-5xl font-semibold leading-[1.06] tracking-tight md:text-7xl">
          Hold {siteConfig.ticker}.
          <br />
          <span className="text-brand">Get paid in {rewardList}.</span>
        </h1>

        <p className="fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Every {cycleMinutes} minutes the engine claims {siteConfig.name}&apos;s pump.fun creator
          fees, splits them {rewardSplit} into {rewardList}, snapshots every {siteConfig.ticker}{' '}
          holder and sends both out pro-rata. No claiming. No staking. No forms.
        </p>

        <div className="fade-up mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="group flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Activity className="h-4 w-4" />
            Live dashboard
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="#eligibility"
            className="flex items-center gap-2 rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            Am I eligible?
          </Link>
        </div>

        <p className="fade-up mt-6 text-xs text-muted-foreground">
          {formatNumber(siteConfig.minEligibleTokens)} {siteConfig.ticker} minimum ·{' '}
          {maxWalletSharePct}% per-wallet cap · liquidity pools excluded
        </p>

        <HeroStats />
      </div>
    </section>
  );
}

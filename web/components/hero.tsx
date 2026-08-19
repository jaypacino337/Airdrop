import Link from 'next/link';
import { ArrowRight, Activity } from 'lucide-react';
import { BullMark, Wordmark } from '@/components/brand';
import { NextDrop } from '@/components/next-drop';
import { HeroStats } from '@/components/hero-stats';
import { Skyline } from '@/components/skyline';
import { cycleMinutes, maxWalletSharePct, rewardList, rewardSplit, siteConfig } from '@/lib/config';
import { formatNumber } from '@/lib/format';

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 md:pt-32 md:pb-20">
      <div aria-hidden className="brand-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0" />
      <Skyline aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full text-[#101a33]/[0.045]" />

      <div className="relative mx-auto max-w-6xl px-6">
        {/* The banner lockup */}
        <div className="fade-up flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-10">
          <Wordmark stacked className="text-center text-5xl sm:text-6xl md:text-left md:text-7xl" />
          <BullMark className="h-24 w-24 shrink-0 md:h-32 md:w-32" id="hero" />
        </div>

        <div className="mt-10 text-center">
          <div className="fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              Live · next drop in <NextDrop />
            </span>
          </div>

          <h1 className="fade-up mx-auto max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight text-navy md:text-5xl">
            Hold {siteConfig.ticker}. Get paid in{' '}
            <span className="text-primary">{rewardList}</span>. Every {cycleMinutes} minutes.
          </h1>

          <p className="fade-up mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            The engine claims {siteConfig.name}&apos;s pump.fun creator fees, splits them{' '}
            {rewardSplit} into {rewardList}, snapshots every {siteConfig.ticker} holder and sends
            both out pro-rata. No claiming. No staking. No forms.
          </p>

          <div className="fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
              className="flex items-center gap-2 rounded-md border border-border bg-background px-6 py-3 text-sm font-medium text-navy transition-colors hover:bg-surface"
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
      </div>
    </section>
  );
}

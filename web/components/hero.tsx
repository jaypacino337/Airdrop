import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Trefoil } from '@/components/brand';
import { NextDrop } from '@/components/next-drop';
import { HeroStats } from '@/components/hero-stats';
import { cycleMinutes, maxWalletSharePct, rewardList, siteConfig } from '@/lib/config';
import { formatNumber } from '@/lib/format';

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-20">
      <div aria-hidden className="brand-glow pointer-events-none absolute inset-0" />
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0" />
      <div aria-hidden className="scanlines pointer-events-none absolute inset-0 opacity-60" />

      <div className="relative mx-auto max-w-5xl px-6 text-center">
        <div className="fade-up mb-8 inline-flex items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-1.5">
          <span className="geiger h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="readout !text-muted-foreground">
            Reactor live · next drop <NextDrop />
          </span>
        </div>

        <div className="fade-up mb-6 flex justify-center">
          <Trefoil className="h-16 w-16 text-primary md:h-20 md:w-20" />
        </div>

        <h1 className="fade-up font-mono text-4xl font-bold uppercase leading-[1.08] tracking-tight md:text-6xl">
          Hold {siteConfig.ticker}.
          <br />
          <span className="text-brand">Get paid in uranium.</span>
        </h1>

        <p className="fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Every {cycleMinutes} minutes the engine takes {siteConfig.name}&apos;s Pons creator fees,
          converts them into {rewardList} — tokenized uranium exposure — snapshots every{' '}
          {siteConfig.ticker} holder on-chain and sends it out pro-rata. No claiming. No staking. No
          forms.
        </p>

        <div className="fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="group flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-opacity hover:opacity-90"
          >
            Live distribution feed
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="#eligibility"
            className="flex items-center gap-2 rounded-md border border-border bg-card px-6 py-3 font-mono text-xs font-medium uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-surface"
          >
            Am I eligible?
          </Link>
        </div>

        <p className="fade-up readout mt-7">
          {formatNumber(siteConfig.minEligibleTokens)} {siteConfig.ticker} minimum ·{' '}
          {maxWalletSharePct}% per-wallet cap · contracts &amp; pools excluded
        </p>

        <HeroStats />
      </div>
    </section>
  );
}

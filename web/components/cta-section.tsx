import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cycleMinutes, rewardList, siteConfig, solscanToken } from '@/lib/config';

export function CtaSection() {
  return (
    <section className="relative overflow-hidden border-t border-border bg-[var(--flag-navy-deep)] py-24 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: 'linear-gradient(to right, var(--flag-red) 0 50%, #ffffff 50% 100%)' }}
      />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          The clock is already running.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/75">
          The next snapshot happens in under {cycleMinutes} minutes, whether or not you are in it.
          Hold {siteConfig.ticker} and you are — paid in {rewardList}, automatically.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          {siteConfig.links.pumpfun || siteConfig.tokenMint ? (
            <a
              href={siteConfig.links.pumpfun || solscanToken(siteConfig.tokenMint)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded-md bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get {siteConfig.ticker}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          ) : null}
          <Link
            href="/dashboard"
            className="text-sm text-white/70 underline underline-offset-4 transition-colors hover:text-white"
          >
            Watch the live dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

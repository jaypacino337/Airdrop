import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cycleMinutes, siteConfig, solscanToken } from '@/lib/config';

export function CtaSection() {
  return (
    <section className="relative overflow-hidden border-t border-border py-24">
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 rotate-180" />
      <div
        aria-hidden
        className="brand-glow pointer-events-none absolute left-1/2 top-1/2 h-72 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
      />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          The clock is already running.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          The next snapshot happens in under {cycleMinutes} minutes, whether or not you are in it.
          Hold {siteConfig.ticker}, and you are.
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
            className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Watch the live dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

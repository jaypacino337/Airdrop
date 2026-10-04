import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Trefoil } from '@/components/brand';
import { cycleMinutes, siteConfig } from '@/lib/config';

export function CtaSection() {
  return (
    <section className="relative overflow-hidden border-t border-border py-24">
      <div aria-hidden className="hazard absolute inset-x-0 top-0" />
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 rotate-180" />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <div className="mb-6 flex justify-center">
          <Trefoil className="geiger h-10 w-10 text-primary" />
        </div>
        <h2 className="text-balance font-mono text-3xl font-bold uppercase tracking-tight md:text-5xl">
          The reactor is already running.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          The next snapshot happens in under {cycleMinutes} minutes, whether or not you are in it.
          Hold {siteConfig.ticker} and you are — paid in uranium, automatically.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          {siteConfig.links.pons ? (
            <a
              href={siteConfig.links.pons}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded-md bg-primary px-8 py-3 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get {siteConfig.ticker} on Pons
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          ) : null}
          <Link
            href="/dashboard"
            className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Watch the live feed
          </Link>
        </div>
      </div>
    </section>
  );
}

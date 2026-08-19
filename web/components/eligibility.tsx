import { Ban, Coins, Gauge, Recycle } from 'lucide-react';
import { WalletChecker } from '@/components/wallet-checker';
import { maxWalletSharePct, siteConfig } from '@/lib/config';
import { formatNumber } from '@/lib/format';

const rules = [
  {
    icon: Coins,
    title: `${formatNumber(siteConfig.minEligibleTokens)} ${siteConfig.ticker} minimum`,
    body: `A wallet needs at least ${formatNumber(siteConfig.minEligibleTokens)} ${siteConfig.ticker} at the moment of the snapshot. Below that it is skipped — the transfer fee would eat the reward.`,
  },
  {
    icon: Gauge,
    title: `${maxWalletSharePct}% per-wallet cap`,
    body: `No wallet can take more than ${maxWalletSharePct}% of a single distribution, however large it is. Anything above the cap is redistributed across everyone still under it.`,
  },
  {
    icon: Ban,
    title: 'Pools and vaults excluded',
    body: 'Liquidity pools, bonding curves, program vaults and the distributor wallet are removed from the snapshot, so rewards go to real holders instead of back into the AMM.',
  },
  {
    icon: Recycle,
    title: 'Nothing is stranded',
    body: `Rounding dust and anything too small to send stays in the distributor and rolls straight into the next cycle's pot.`,
  },
];

export function Eligibility() {
  return (
    <section id="eligibility" className="scroll-mt-24 border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              Eligibility
            </p>
            <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
              The rules, in full.
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Four rules decide every distribution. They are applied by the same code every cycle —
              there is no manual list and no discretion.
            </p>

            <ul className="mt-10 flex flex-col gap-px overflow-hidden rounded-xl bg-border">
              {rules.map((rule) => {
                const Icon = rule.icon;
                return (
                  <li key={rule.title} className="flex gap-4 bg-background p-6">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-brand">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="mb-1.5 text-sm font-semibold">{rule.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{rule.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <WalletChecker />
          </div>
        </div>
      </div>
    </section>
  );
}

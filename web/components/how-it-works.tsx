import { Banknote, Camera, Send, ShoppingCart } from 'lucide-react';
import { cycleMinutes, siteConfig } from '@/lib/config';

const steps = [
  {
    icon: Banknote,
    title: 'Claim creator fees',
    body: `The engine collects the pump.fun creator fees ${siteConfig.name} has earned since the last run. Nothing accumulates in a treasury — it is swept every ${cycleMinutes} minutes.`,
  },
  {
    icon: ShoppingCart,
    title: `Buy ${siteConfig.rewardTicker}`,
    body: `The claimed SOL is routed through Jupiter to buy ${siteConfig.rewardTicker} at market. A small SOL reserve is kept back purely to pay network fees.`,
  },
  {
    icon: Camera,
    title: 'Snapshot holders',
    body: `Every wallet holding ${siteConfig.ticker} is read straight from chain state at that moment. Liquidity pools, program vaults and the distributor itself are filtered out.`,
  },
  {
    icon: Send,
    title: 'Distribute pro-rata',
    body: `Each qualifying wallet's share is calculated, the per-wallet cap is applied, and ${siteConfig.rewardTicker} is transferred directly. It simply appears in your wallet.`,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
            The {cycleMinutes}-minute cycle
          </p>
          <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Four steps, on a loop, forever.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            The worker runs the same sequence every cycle and writes each leg to a public ledger, so
            every drop can be checked against the chain.
          </p>
        </div>

        <ol className="hairline-grid grid overflow-hidden rounded-xl sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex flex-col gap-4 bg-background p-8">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-brand">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="tnum font-mono text-sm text-muted-foreground">
                    0{index + 1}
                  </span>
                </div>
                <div>
                  <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

import { Banknote, Camera, Send, ShoppingCart } from 'lucide-react';
import { cycleMinutes, rewardList, siteConfig } from '@/lib/config';

const steps = [
  {
    icon: Banknote,
    title: 'Fees hit the treasury',
    body: `Every cycle the engine claims the pump.fun creator fees from ${siteConfig.ticker} trading into the treasury wallet. Every claim is a public Solana transaction — the treasury address is public.`,
  },
  {
    icon: ShoppingCart,
    title: 'Treasury acquires uranium',
    body: `The treasury converts fees into ${rewardList} — tokenized uranium exposure. What the treasury holds is what gets dropped; there is nothing synthetic in between.`,
  },
  {
    icon: Camera,
    title: 'Holders are snapshotted',
    body: `The engine reads every ${siteConfig.ticker} token account on Solana at a single slot. Pools, the bonding curve and every other program-owned (PDA) account are filtered out automatically.`,
  },
  {
    icon: Send,
    title: 'Airdrop, pro-rata',
    body: `Each qualifying wallet's share is calculated, the per-wallet cap is applied, and ${rewardList} is transferred directly — the engine even opens your token account if you don't have one. It simply appears in your wallet.`,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <p className="readout mb-3 !text-brand">The {cycleMinutes}-minute cycle</p>
          <h2 className="text-balance font-mono text-3xl font-bold uppercase tracking-tight md:text-5xl">
            Four steps, on a loop, forever.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            The engine runs the same sequence every cycle and writes each leg to a public ledger, so
            every drop can be checked against the chain.
          </p>
        </div>

        <ol className="hairline-grid grid overflow-hidden rounded-md border border-border sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex flex-col gap-4 bg-card p-8">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-brand">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="tnum font-mono text-sm text-muted-foreground">0{index + 1}</span>
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

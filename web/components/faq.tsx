import { cycleMinutes, maxWalletSharePct, rewardList, siteConfig } from '@/lib/config';
import { formatNumber } from '@/lib/format';

const faqs = [
  {
    q: 'Do I have to claim anything?',
    a: `No. The engine transfers ${rewardList} straight to your wallet on-chain. There is nothing to sign, nothing to stake and no site to visit — the dashboard just shows you what already happened.`,
  },
  {
    q: 'What exactly funds the airdrop?',
    a: `${siteConfig.name}'s creator fees from Pons trading. They accrue to the public treasury wallet, get converted into ${rewardList}, and go out every ${cycleMinutes} minutes. More volume, bigger drops; no volume means a cycle simply passes.`,
  },
  {
    q: 'What is the "uranium" I receive?',
    a: `Tokenized uranium exposure — currently ${rewardList}. It is a real transferable token in your wallet, not points or a synthetic IOU. Which token the treasury distributes is published on this page and can evolve (for example if physical-uranium tokens open their whitelist).`,
  },
  {
    q: 'How is my share calculated?',
    a: `Pro-rata: your ${siteConfig.ticker} balance divided by all qualifying balances, capped at ${maxWalletSharePct}% of the pot. What a capped whale cannot take is redistributed to everyone still under the cap.`,
  },
  {
    q: 'Why is there a cap at all?',
    a: `Without it one whale would absorb most of every distribution. The ${maxWalletSharePct}% ceiling keeps drops meaningful across the whole holder base.`,
  },
  {
    q: 'What happens if I sell before a snapshot?',
    a: 'Then you are not in that snapshot. Balances are read from the chain at the instant the cycle runs — no lock-up, no vesting, no penalty, but no back-pay either.',
  },
  {
    q: 'Can I verify all of this?',
    a: 'Yes. The treasury address is public, every transfer is a transaction linked from the dashboard, and the holder snapshot behind each distribution is published too.',
  },
  {
    q: `Why ${formatNumber(siteConfig.minEligibleTokens)} ${siteConfig.ticker} minimum?`,
    a: 'Below roughly that size a payout is worth less than the gas needed to send it. The minimum keeps the distribution economical instead of burning the pot on dust transfers.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <p className="readout mb-3 !text-brand">FAQ</p>
          <h2 className="text-balance font-mono text-3xl font-bold uppercase tracking-tight md:text-5xl">
            Questions people actually ask.
          </h2>
        </div>

        <div className="hairline-grid grid overflow-hidden rounded-md border border-border md:grid-cols-2">
          {faqs.map((faq) => (
            <article key={faq.q} className="bg-card p-8">
              <h3 className="mb-2 text-base font-semibold">{faq.q}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

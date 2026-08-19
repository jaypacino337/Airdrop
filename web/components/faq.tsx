import { cycleMinutes, maxWalletSharePct, rewardList, rewardSplit, rewardTokens, siteConfig } from '@/lib/config';
import { formatNumber } from '@/lib/format';

const faqs = [
  {
    q: 'Do I have to claim anything?',
    a: `No. The distributor sends ${rewardList} straight to your wallet. If you do not yet have a token account for one of them, the engine creates it for you and pays the rent itself.`,
  },
  {
    q: 'What exactly funds the airdrop?',
    a: `${siteConfig.name}'s pump.fun creator fees. Every ${cycleMinutes} minutes the engine claims whatever has accrued and splits it ${rewardSplit} across ${rewardList}. More trading volume means bigger drops; no volume means a cycle simply passes with nothing to hand out.`,
  },
  {
    q: 'How is my share calculated?',
    a: `Pro-rata against every other qualifying wallet: your ${siteConfig.ticker} balance divided by the total ${siteConfig.ticker} held by all qualifying wallets, then capped at ${maxWalletSharePct}% of the pot. The same share applies to both tokens, and what a capped wallet cannot take is redistributed to everyone still under the cap.`,
  },
  {
    q: 'Why is there a cap at all?',
    a: `Without it one whale would absorb most of every distribution and there would be no reason for anyone else to hold. The ${maxWalletSharePct}% ceiling keeps drops meaningful across the whole holder base.`,
  },
  {
    q: `Why ${rewardTokens.map((t) => t.symbol).join(' and ')}?`,
    a: `The buy is split ${rewardSplit} between them, so every drop pays you in both rather than betting the whole pot on one. The split is a single setting and is applied identically every cycle.`,
  },
  {
    q: 'What happens if I sell before a snapshot?',
    a: 'Then you are simply not in that snapshot. Balances are read at the instant the cycle runs — there is no lock-up, no vesting and no penalty, but no back-pay either.',
  },
  {
    q: 'What if a cycle fails?',
    a: 'It is recorded as failed with the reason, and the next cycle picks up where it left off. Payouts are written to the ledger before they are sent, so a restart resumes rather than pays twice.',
  },
  {
    q: 'Can I verify all of this?',
    a: 'Yes. Every claim, buy and transfer is a Solana transaction linked from the dashboard, and the snapshot behind each distribution is published there too.',
  },
  {
    q: 'Who pays the network fees?',
    a: `The distributor wallet does. It keeps a small SOL reserve back from every buy, and it also pays the one-off rent to open a ${rewardList} token account for any holder who does not have one yet.`,
  },
  {
    q: `Why ${formatNumber(siteConfig.minEligibleTokens)} ${siteConfig.ticker} minimum?`,
    a: 'Below roughly that size a payout is worth less than the network fee needed to send it. The minimum keeps the whole distribution economical instead of burning the pot on dust transfers.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand">FAQ</p>
          <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Questions people actually ask.
          </h2>
        </div>

        <div className="grid gap-px overflow-hidden rounded-xl bg-border md:grid-cols-2">
          {faqs.map((faq) => (
            <article key={faq.q} className="bg-background p-8">
              <h3 className="mb-2 text-base font-semibold">{faq.q}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

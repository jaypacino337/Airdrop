import Link from 'next/link';
import { BrandLock } from '@/components/brand';
import { cycleMinutes, rewardList, rewardTokens, siteConfig, solscanToken } from '@/lib/config';

const columns = [
  {
    heading: 'Protocol',
    links: [
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'Eligibility rules', href: '/#eligibility' },
      { label: 'Live dashboard', href: '/dashboard' },
      { label: 'FAQ', href: '/#faq' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border pt-16 pb-10">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-10 md:flex-row md:gap-0">
          <div className="shrink-0 md:w-80">
            <BrandLock className="text-foreground" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Creator fees in. {rewardList} out. Every {cycleMinutes} minutes, to every wallet that
              qualifies — automatically.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 md:flex md:flex-1 md:justify-end md:gap-16">
            {columns.map((column) => (
              <div key={column.heading}>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-foreground">
                  {column.heading}
                </p>
                <ul className="flex flex-col gap-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-foreground">
                On-chain
              </p>
              <ul className="flex flex-col gap-2.5">
                {siteConfig.tokenMint ? (
                  <li>
                    <a
                      href={solscanToken(siteConfig.tokenMint)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {siteConfig.ticker} contract
                    </a>
                  </li>
                ) : null}
                {rewardTokens
                  .filter((token) => token.mint)
                  .map((token) => (
                    <li key={token.mint}>
                      <a
                        href={solscanToken(token.mint)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {token.symbol} contract
                      </a>
                    </li>
                  ))}
                {siteConfig.links.twitter ? (
                  <li>
                    <a
                      href={siteConfig.links.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      X / Twitter
                    </a>
                  </li>
                ) : null}
                {siteConfig.links.telegram ? (
                  <li>
                    <a
                      href={siteConfig.links.telegram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Telegram
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-8 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}. Distributions are automated and
            verifiable on-chain.
          </p>
          <p className="max-w-lg sm:text-right">
            An independent community project. Not affiliated with, endorsed by or connected to
            Donald J. Trump, the Trump Organization, World Liberty Financial or any of their
            affiliates. Nothing here is financial advice. Crypto assets are volatile and you can
            lose everything you put in.
          </p>
        </div>
      </div>
    </footer>
  );
}

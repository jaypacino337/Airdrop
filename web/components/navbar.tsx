'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Menu, X } from 'lucide-react';
import { BrandLock } from '@/components/brand';
import { siteConfig, solscanToken } from '@/lib/config';
import { shortAddress } from '@/lib/format';

const links = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Eligibility', href: '/#eligibility' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'Dashboard', href: '/dashboard' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="text-foreground transition-opacity hover:opacity-80">
          <BrandLock />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {siteConfig.tokenMint ? (
            <a
              href={solscanToken(siteConfig.tokenMint)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              title="View the MRNA contract on Solscan"
            >
              {shortAddress(siteConfig.tokenMint)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          <Link
            href="/dashboard"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Live dashboard
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-muted-foreground transition-colors hover:text-foreground md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-4 border-t border-border bg-background px-6 py-5 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="mt-1 rounded-md bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground"
          >
            Live dashboard
          </Link>
        </div>
      ) : null}
    </header>
  );
}

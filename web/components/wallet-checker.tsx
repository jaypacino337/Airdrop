'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';
import { decimalsFor, maxWalletSharePct, rewardList, siteConfig, solscanTx } from '@/lib/config';
import { formatNumber, formatRaw, isSolanaAddress, shortAddress, timeAgo } from '@/lib/format';
import type { WalletResponse } from '@/lib/types';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: WalletResponse };

/** Paste a wallet, see whether it qualified in the last snapshot and what it has been paid. */
export function WalletChecker() {
  const [address, setAddress] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = address.trim();
    if (!isSolanaAddress(value)) {
      setState({ kind: 'error', message: 'That does not look like a Solana wallet address.' });
      return;
    }

    setState({ kind: 'loading' });
    try {
      const response = await fetch(`/api/wallet/${encodeURIComponent(value)}`, { cache: 'no-store' });
      const payload = (await response.json()) as WalletResponse & { error?: string };
      if (!response.ok) {
        setState({ kind: 'error', message: payload.error ?? 'Lookup failed. Try again in a moment.' });
        return;
      }
      setState({ kind: 'ready', data: payload });
    } catch {
      setState({ kind: 'error', message: 'Lookup failed. Try again in a moment.' });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 md:p-8">
      <h3 className="text-lg font-semibold">Check a wallet</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        See where an address stood in the most recent snapshot, and what it has been paid in{' '}
        {rewardList}.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="wallet" className="sr-only">
          Solana wallet address
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="wallet"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Paste a Solana address"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-background py-2.5 pl-9 pr-3 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={state.kind === 'loading'}
          className="flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {state.kind === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          Check
        </button>
      </form>

      {state.kind === 'error' ? (
        <p className="mt-4 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-brand">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'ready' ? <WalletResult data={state.data} /> : null}

      {state.kind === 'idle' ? (
        <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Hold at least {formatNumber(siteConfig.minEligibleTokens)} {siteConfig.ticker} when the
          snapshot is taken and you are in — nothing to sign up for.
        </div>
      ) : null}
    </div>
  );
}

function WalletResult({ data }: { data: WalletResponse }) {
  const eligible = data.eligible;

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3.5 ${
          eligible ? 'border-accent/30 bg-accent/10' : 'border-border bg-surface'
        }`}
      >
        {eligible ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="text-sm">
          <p className="font-medium">
            {eligible ? 'Qualified in the last snapshot' : 'Not in the last snapshot'}
          </p>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            {eligible
              ? `Balance ${formatNumber(data.balanceUi)} ${siteConfig.ticker} · ${(
                  data.shareBps / 100
                ).toFixed(2)}% of that distribution${data.capped ? ` (capped at ${maxWalletSharePct}%)` : ''}.`
              : `This wallet was below the ${formatNumber(siteConfig.minEligibleTokens)} ${siteConfig.ticker} minimum, or was excluded as a pool or program account.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border">
        {(data.totals.length > 0
          ? data.totals
          : [{ mint: '', symbol: '—', totalReceivedRaw: '0', payoutCount: 0 }]
        ).map((total) => (
          <div key={total.mint || total.symbol} className="bg-background p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {total.symbol} received
            </p>
            <p className="tnum mt-1 text-xl font-semibold text-brand">
              {formatRaw(total.totalReceivedRaw, decimalsFor(total.mint, total.symbol), 4)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatNumber(total.payoutCount)} payouts
            </p>
          </div>
        ))}
      </div>

      {data.history.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.history.slice(0, 6).map((payout) => (
            <li
              key={`${payout.cycle_id}-${payout.created_at}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="text-muted-foreground">
                {timeAgo(payout.confirmed_at ?? payout.created_at)}
              </span>
              <span className="tnum font-medium">
                {formatRaw(payout.amount_raw, decimalsFor(payout.mint, payout.symbol), 4)}{' '}
                <span className="text-xs font-normal text-muted-foreground">{payout.symbol}</span>
              </span>
              {payout.signature ? (
                <a
                  href={solscanTx(payout.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {shortAddress(payout.signature, 4)}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">{payout.status}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {data.warning ? <p className="text-xs text-muted-foreground">{data.warning}</p> : null}
    </div>
  );
}

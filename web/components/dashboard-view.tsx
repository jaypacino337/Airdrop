'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FlaskConical } from 'lucide-react';
import { NextDrop } from '@/components/next-drop';
import { WalletChecker } from '@/components/wallet-checker';
import {
  decimalsFor,
  explorerAddress,
  explorerTx,
  maxWalletSharePct,
  rewardList,
  rewardTokens,
  siteConfig,
} from '@/lib/config';
import { formatNative, formatNumber, formatRaw, shortAddress, timeAgo } from '@/lib/format';
import type { Cycle, CycleReward, HoldersResponse, Payout } from '@/lib/types';
import { useLiveStats } from '@/lib/use-live-stats';

const EMPTY_HOLDERS: HoldersResponse = {
  cycleId: null,
  takenAt: null,
  eligibleCount: 0,
  cappedCount: 0,
  holders: [],
};

export function DashboardView() {
  const { data: live } = useLiveStats(15_000);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [holders, setHolders] = useState<HoldersResponse>(EMPTY_HOLDERS);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [cyclesRes, holdersRes, activityRes] = await Promise.all([
          fetch('/api/cycles?limit=15', { cache: 'no-store' }),
          fetch('/api/holders?limit=50', { cache: 'no-store' }),
          fetch('/api/activity', { cache: 'no-store' }),
        ]);
        const [cyclesJson, holdersJson, activityJson] = await Promise.all([
          cyclesRes.json().catch(() => ({ cycles: [] })),
          holdersRes.json().catch(() => EMPTY_HOLDERS),
          activityRes.json().catch(() => ({ payouts: [] })),
        ]);
        if (cancelled) return;
        setCycles((cyclesJson.cycles ?? []) as Cycle[]);
        setHolders((holdersJson ?? EMPTY_HOLDERS) as HoldersResponse);
        setPayouts((activityJson.payouts ?? []) as Payout[]);
      } catch {
        // Leave the last good render in place.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const stats = live.stats;
  const dryRun = live.lastCycle?.dry_run ?? false;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6">
      <header>
        <p className="readout mb-2 !text-brand">Distribution log</p>
        <h1 className="font-mono text-3xl font-bold uppercase tracking-tight md:text-5xl">
          Live feed
        </h1>
        <p className="mt-2 text-muted-foreground">
          Every snapshot and every transfer the engine has made across {rewardList} — refreshed
          automatically.
        </p>
      </header>

      {!live.configured || live.warning ? (
        <Banner
          icon={<AlertTriangle className="h-4 w-4" />}
          text={
            live.warning ??
            'The ledger is not connected yet — numbers will appear once the engine runs its first cycle.'
          }
        />
      ) : null}

      {dryRun ? (
        <Banner
          icon={<FlaskConical className="h-4 w-4" />}
          text="The engine is running in dry-run mode: cycles are simulated and recorded, but no funds move."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <div className="panel flex items-center justify-center rounded-md p-8">
          <NextDrop size="lg" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {rewardTokens.map((token) => {
            const total = live.rewardTotals.find(
              (row) =>
                row.token === token.token || row.symbol.toUpperCase() === token.symbol.toUpperCase(),
            );
            return (
              <StatCard
                key={token.symbol}
                label={`${token.symbol} distributed`}
                value={formatRaw(total?.distributed_raw ?? '0', decimalsFor(token.token, token.symbol), 4)}
                sub={`${formatNumber(total?.payout_count ?? 0)} payouts · ${token.weightBps / 100}% of each buy`}
              />
            );
          })}
          <StatCard
            label="Distributions"
            value={formatNumber(stats.completed_cycles)}
            sub={`last ${timeAgo(stats.last_completed_at)}`}
          />
          <StatCard
            label="Wallets paid"
            value={formatNumber(stats.unique_recipients)}
            sub={`${formatNumber(holders.eligibleCount)} eligible in the last snapshot`}
          />
        </div>
      </div>

      <Panel
        title="Distribution history"
        subtitle={loaded && cycles.length === 0 ? 'No cycles recorded yet.' : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>When</Th>
                <Th>Status</Th>
                <Th className="text-right">Distributed</Th>
                <Th className="text-right">Wallets</Th>
                <Th className="text-right">Holders</Th>
                <Th className="text-right">Proof</Th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((cycle) => (
                <tr key={cycle.id} className="border-b border-border/50 transition-colors hover:bg-surface/60">
                  <Td className="whitespace-nowrap text-muted-foreground">
                    {timeAgo(cycle.finished_at ?? cycle.started_at)}
                  </Td>
                  <Td>
                    <StatusPill status={cycle.status} dryRun={cycle.dry_run} />
                  </Td>
                  <Td className="text-right">
                    <RewardBreakdown rewards={cycle.cycle_rewards ?? []} />
                  </Td>
                  <Td className="tnum text-right font-mono">{formatNumber(cycle.payout_count)}</Td>
                  <Td className="tnum text-right font-mono text-muted-foreground">
                    {formatNumber(cycle.eligible_count)}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-3">
                      {(cycle.cycle_rewards ?? [])
                        .filter((reward) => reward.swap_tx)
                        .map((reward) => (
                          <TxLink key={reward.token} hash={reward.swap_tx!} label={reward.symbol.toLowerCase()} />
                        ))}
                      {cycle.block_number ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          #{cycle.block_number}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {cycles.length === 0 ? <EmptyRow colSpan={6} text="No distributions yet." /> : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Latest snapshot"
          subtitle={
            holders.takenAt
              ? `Taken ${timeAgo(holders.takenAt)} · ${formatNumber(holders.eligibleCount)} eligible wallets · ${formatNumber(holders.cappedCount)} hit the ${maxWalletSharePct}% cap`
              : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <Th className="w-10">#</Th>
                  <Th>Wallet</Th>
                  <Th className="text-right">{siteConfig.ticker} held</Th>
                  <Th className="text-right">Share of each drop</Th>
                </tr>
              </thead>
              <tbody>
                {holders.holders.map((holder, index) => (
                  <tr
                    key={holder.owner}
                    className="border-b border-border/50 transition-colors hover:bg-surface/60"
                  >
                    <Td className="tnum font-mono text-muted-foreground">{index + 1}</Td>
                    <Td>
                      <AddressLink address={holder.owner} />
                    </Td>
                    <Td className="tnum text-right font-mono">{formatNumber(holder.balance_ui)}</Td>
                    <Td className="tnum text-right font-mono font-semibold text-brand">
                      {(holder.share_bps / 100).toFixed(2)}%
                      {holder.capped ? (
                        <span className="ml-2 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                          CAPPED
                        </span>
                      ) : null}
                    </Td>
                  </tr>
                ))}
                {holders.holders.length === 0 ? (
                  <EmptyRow colSpan={4} text="No snapshot has been taken yet." />
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Recent payouts">
          <ul className="flex flex-col divide-y divide-border">
            {payouts.map((payout) => (
              <li
                key={`${payout.cycle_id}-${payout.owner}-${payout.token}`}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <AddressLink address={payout.owner} />
                <span className="tnum font-mono font-medium">
                  {formatRaw(payout.amount_raw, decimalsFor(payout.token, payout.symbol), 4)}{' '}
                  <span className="text-xs font-normal text-muted-foreground">{payout.symbol}</span>
                </span>
                {payout.tx_hash && explorerTx(payout.tx_hash) ? (
                  <TxLink hash={payout.tx_hash} label="tx" />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {timeAgo(payout.confirmed_at ?? payout.created_at)}
                  </span>
                )}
              </li>
            ))}
            {payouts.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">Nothing sent yet.</li>
            ) : null}
          </ul>
        </Panel>
      </div>

      <WalletChecker />

      <p className="readout text-center">
        Treasury native spent on buybacks: {formatNative(stats.total_native_spent_wei)} ·{' '}
        {formatNumber(stats.total_payouts)} total payouts
      </p>
    </div>
  );
}

/** Per-token amounts for one cycle. Different decimals never get summed. */
function RewardBreakdown({ rewards }: { rewards: CycleReward[] }) {
  if (rewards.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {rewards.map((reward) => (
        <span key={reward.token} className="tnum font-mono text-xs">
          <span className="font-semibold text-brand">
            {formatRaw(reward.distributed_raw, reward.decimals || decimalsFor(reward.token, reward.symbol), 4)}
          </span>{' '}
          <span className="text-muted-foreground">{reward.symbol}</span>
        </span>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel rounded-md p-6">
      <p className="readout">{label}</p>
      <p className="tnum mt-2 font-mono text-3xl font-bold tracking-tight text-brand">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rounded-md p-6">
      <div className="mb-5">
        <h2 className="font-mono text-base font-bold uppercase tracking-[0.08em]">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Banner({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-brand">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function StatusPill({ status, dryRun }: { status: Cycle['status']; dryRun: boolean }) {
  const tone =
    status === 'completed'
      ? 'border-accent/40 bg-accent/10 text-accent'
      : status === 'failed'
        ? 'border-primary/40 bg-primary/10 text-brand'
        : 'border-border bg-surface text-muted-foreground';

  return (
    <span className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase ${tone}`}>
      {dryRun ? 'dry run' : status}
    </span>
  );
}

function AddressLink({ address }: { address: string }) {
  const href = explorerAddress(address);
  const text = shortAddress(address, 5);
  if (!href) return <span className="font-mono text-xs text-muted-foreground">{text}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {text}
    </a>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  const href = explorerTx(hash);
  if (!href) return <span className="font-mono text-xs text-muted-foreground">{label}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`readout px-3 py-2.5 !font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

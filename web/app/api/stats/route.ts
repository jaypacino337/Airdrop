import { NextResponse } from 'next/server';
import { siteConfig } from '@/lib/config';
import { supabaseConfigured, supabaseSelect, supabaseSingle } from '@/lib/supabase';
import type { AirdropStats, Cycle, StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EMPTY: AirdropStats = {
  completed_cycles: 0,
  total_claimed_lamports: '0',
  total_sol_spent_lamports: '0',
  total_reward_bought_raw: '0',
  total_reward_distributed_raw: '0',
  total_payouts: 0,
  unique_recipients: 0,
  last_completed_at: null,
  last_eligible_count: 0,
};

/** The engine runs on a fixed interval, so the next drop is derivable. */
function nextDropAt(lastFinishedAt: string | null): string {
  const interval = siteConfig.cycleIntervalMs;
  const last = lastFinishedAt ? Date.parse(lastFinishedAt) : NaN;
  if (Number.isFinite(last)) {
    let next = last + interval;
    // If the worker missed a beat, roll forward to the next slot in the future.
    if (next < Date.now()) next = Date.now() + (interval - ((Date.now() - last) % interval));
    return new Date(next).toISOString();
  }
  return new Date(Math.ceil(Date.now() / interval) * interval).toISOString();
}

export async function GET() {
  if (!supabaseConfigured) {
    return NextResponse.json<StatsResponse>({
      configured: false,
      stats: EMPTY,
      lastCycle: null,
      nextDropAt: nextDropAt(null),
      warning: 'Supabase is not configured yet — showing an empty ledger.',
    });
  }

  try {
    const [stats, cycles] = await Promise.all([
      supabaseSingle<AirdropStats>('airdrop_stats?select=*'),
      supabaseSelect<Cycle>('cycles?select=*&order=started_at.desc&limit=1'),
    ]);

    const lastCycle = cycles[0] ?? null;
    return NextResponse.json<StatsResponse>({
      configured: true,
      stats: stats ?? EMPTY,
      lastCycle,
      nextDropAt: nextDropAt(stats?.last_completed_at ?? lastCycle?.finished_at ?? null),
    });
  } catch (error) {
    console.error('stats route failed', error);
    return NextResponse.json<StatsResponse>({
      configured: true,
      stats: EMPTY,
      lastCycle: null,
      nextDropAt: nextDropAt(null),
      warning: 'Live stats are temporarily unavailable.',
    });
  }
}

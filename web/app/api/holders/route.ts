import { NextResponse } from 'next/server';
import { supabaseConfigured, supabaseSelect } from '@/lib/supabase';
import type { Cycle, HoldersResponse, SnapshotHolder } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EMPTY: HoldersResponse = {
  cycleId: null,
  takenAt: null,
  eligibleCount: 0,
  cappedCount: 0,
  holders: [],
};

/** The holder table always reflects the most recent completed snapshot. */
export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 200) : 50;

  if (!supabaseConfigured) return NextResponse.json(EMPTY);

  try {
    const cycles = await supabaseSelect<Cycle>(
      'cycles?select=id,started_at,finished_at,eligible_count,capped_count&status=in.(completed,skipped)&order=started_at.desc&limit=1',
    );
    const cycle = cycles[0];
    if (!cycle) return NextResponse.json(EMPTY);

    const holders = await supabaseSelect<SnapshotHolder>(
      `snapshot_holders?select=owner,balance_raw,balance_ui,share_bps,capped,allocation_raw&cycle_id=eq.${cycle.id}&order=balance_raw.desc&limit=${limit}`,
    );

    return NextResponse.json<HoldersResponse>({
      cycleId: cycle.id,
      takenAt: cycle.finished_at ?? cycle.started_at,
      eligibleCount: cycle.eligible_count ?? holders.length,
      cappedCount: cycle.capped_count ?? 0,
      holders,
    });
  } catch (error) {
    console.error('holders route failed', error);
    return NextResponse.json({ ...EMPTY, warning: 'The holder snapshot is temporarily unavailable.' });
  }
}

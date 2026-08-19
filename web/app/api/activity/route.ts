import { NextResponse } from 'next/server';
import { supabaseConfigured, supabaseSelect } from '@/lib/supabase';
import type { Payout } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Most recent confirmed payouts — powers the live ticker on the dashboard. */
export async function GET() {
  if (!supabaseConfigured) return NextResponse.json({ payouts: [] as Payout[] });

  try {
    const payouts = await supabaseSelect<Payout>(
      'payouts?select=cycle_id,owner,amount_raw,status,signature,created_at,confirmed_at&status=eq.confirmed&order=confirmed_at.desc&limit=25',
    );
    return NextResponse.json({ payouts });
  } catch (error) {
    console.error('activity route failed', error);
    return NextResponse.json({ payouts: [] as Payout[] });
  }
}

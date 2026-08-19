import { NextResponse } from 'next/server';
import { supabaseConfigured, supabaseSelect } from '@/lib/supabase';
import type { Cycle } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 15);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 100) : 15;

  if (!supabaseConfigured) return NextResponse.json({ cycles: [] as Cycle[] });

  try {
    const cycles = await supabaseSelect<Cycle>(
      `cycles?select=*,cycle_rewards(*)&order=started_at.desc&limit=${limit}`,
    );
    return NextResponse.json({ cycles });
  } catch (error) {
    console.error('cycles route failed', error);
    return NextResponse.json({ cycles: [] as Cycle[], warning: 'Distribution history is temporarily unavailable.' });
  }
}

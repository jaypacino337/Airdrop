import { NextResponse } from 'next/server';
import { siteConfig } from '@/lib/config';
import { isSolanaAddress } from '@/lib/format';
import { supabaseConfigured, supabaseSelect } from '@/lib/supabase';
import type { Cycle, Payout, SnapshotHolder, WalletResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LeaderboardRow {
  owner: string;
  total_received_raw: string;
  payout_count: number;
}

/**
 * Wallet lookup: where a wallet stood in the last snapshot, and everything it
 * has ever been paid.
 */
export async function GET(_request: Request, context: { params: Promise<{ address: string }> }) {
  const { address: raw } = await context.params;
  const address = decodeURIComponent(raw ?? '').trim();

  if (!isSolanaAddress(address)) {
    return NextResponse.json({ error: 'That does not look like a Solana wallet address.' }, { status: 400 });
  }

  const empty: WalletResponse = {
    address,
    eligible: false,
    balanceUi: 0,
    shareBps: 0,
    capped: false,
    lastAllocationRaw: '0',
    totalReceivedRaw: '0',
    payoutCount: 0,
    history: [],
  };

  if (!supabaseConfigured) {
    return NextResponse.json({ ...empty, warning: 'Supabase is not configured yet.' });
  }

  try {
    const cycles = await supabaseSelect<Cycle>(
      'cycles?select=id&status=in.(completed,skipped)&order=started_at.desc&limit=1',
    );
    const cycleId = cycles[0]?.id;

    const [snapshot, totals, history] = await Promise.all([
      cycleId
        ? supabaseSelect<SnapshotHolder>(
            `snapshot_holders?select=owner,balance_raw,balance_ui,share_bps,capped,allocation_raw&cycle_id=eq.${cycleId}&owner=eq.${address}&limit=1`,
          )
        : Promise.resolve([]),
      supabaseSelect<LeaderboardRow>(`leaderboard?select=*&owner=eq.${address}&limit=1`),
      supabaseSelect<Payout>(
        `payouts?select=cycle_id,owner,amount_raw,status,signature,created_at,confirmed_at&owner=eq.${address}&order=created_at.desc&limit=25`,
      ),
    ]);

    const row = snapshot[0];
    const total = totals[0];

    return NextResponse.json<WalletResponse>({
      address,
      eligible: Boolean(row) && (row?.balance_ui ?? 0) >= siteConfig.minEligibleTokens,
      balanceUi: row?.balance_ui ?? 0,
      shareBps: row?.share_bps ?? 0,
      capped: row?.capped ?? false,
      lastAllocationRaw: row?.allocation_raw ?? '0',
      totalReceivedRaw: total?.total_received_raw ?? '0',
      payoutCount: total?.payout_count ?? 0,
      history,
    });
  } catch (error) {
    console.error('wallet route failed', error);
    return NextResponse.json({ ...empty, warning: 'Wallet lookup is temporarily unavailable.' });
  }
}

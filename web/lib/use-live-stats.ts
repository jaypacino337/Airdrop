'use client';

import { useEffect, useState } from 'react';
import type { StatsResponse } from '@/lib/types';

const EMPTY: StatsResponse = {
  configured: false,
  stats: {
    completed_cycles: 0,
    total_claimed_lamports: '0',
    total_sol_spent_lamports: '0',
    total_reward_bought_raw: '0',
    total_reward_distributed_raw: '0',
    total_payouts: 0,
    unique_recipients: 0,
    last_completed_at: null,
    last_eligible_count: 0,
  },
  lastCycle: null,
  nextDropAt: null,
};

/** Polls the read-only stats endpoint. Never throws — the UI degrades quietly. */
export function useLiveStats(pollMs = 15_000): { data: StatsResponse; loading: boolean } {
  const [data, setData] = useState<StatsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/stats', { cache: 'no-store' });
        const payload = (await response.json()) as StatsResponse;
        if (!cancelled) setData(payload);
      } catch {
        // Keep whatever we last had.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollMs]);

  return { data, loading };
}

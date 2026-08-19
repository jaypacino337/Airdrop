'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { siteConfig } from '@/lib/config';
import { useLiveStats } from '@/lib/use-live-stats';

function formatClock(msRemaining: number): string {
  const total = Math.max(0, Math.round(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Counts down to the next distribution. The target comes from the last
 * completed cycle plus the interval; if the engine has never run we fall back
 * to the wall-clock slot so the page still reads sensibly.
 */
export function NextDrop({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const { data } = useLiveStats(20_000);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const target = useMemo(() => {
    const parsed = data.nextDropAt ? Date.parse(data.nextDropAt) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    if (now === null) return null;
    return Math.ceil(now / siteConfig.cycleIntervalMs) * siteConfig.cycleIntervalMs;
  }, [data.nextDropAt, now]);

  // Roll forward locally between polls so the clock never sits at 00:00.
  const remaining = useMemo(() => {
    if (now === null || target === null) return null;
    let next = target;
    while (next <= now) next += siteConfig.cycleIntervalMs;
    return next - now;
  }, [now, target]);

  const label = remaining === null ? '--:--' : formatClock(remaining);

  if (size === 'lg') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Next distribution
        </p>
        <p className="tnum font-mono text-5xl font-bold tracking-tight text-brand md:text-6xl">{label}</p>
      </div>
    );
  }

  return (
    <span className={cn('tnum font-mono font-medium text-brand')} suppressHydrationWarning>
      {label}
    </span>
  );
}

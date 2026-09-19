import { cn } from '@/lib/cn';
import { siteConfig } from '@/lib/config';

/** The mark: a survey-badge trefoil. Yellowcake on graphite. */
export function Trefoil({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('h-8 w-8', className)}>
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.9" />
      <circle cx="32" cy="32" r="6" fill="currentColor" />
      <g fill="currentColor">
        <path d="M45.50 8.62A27.0 27.0 0 0 0 18.50 8.62L26.25 22.04A11.5 11.5 0 0 1 37.75 22.04Z" />
        <path d="M5.00 32.00A27.0 27.0 0 0 0 18.50 55.38L26.25 41.96A11.5 11.5 0 0 1 20.50 32.00Z" />
        <path d="M45.50 55.38A27.0 27.0 0 0 0 59.00 32.00L43.50 32.00A11.5 11.5 0 0 1 37.75 41.96Z" />
      </g>
    </svg>
  );
}

/** Mark + wordmark, as used in the header and footer. */
export function BrandLock({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Trefoil className="h-7 w-7 shrink-0 text-primary" />
      <span className="font-mono text-sm font-semibold tracking-[0.14em]">
        <span className="text-brand">URANIUM</span>{' '}
        <span className="text-foreground">STRATEGY</span>
        <span className="text-muted-foreground"> · ${siteConfig.ticker}</span>
      </span>
    </span>
  );
}

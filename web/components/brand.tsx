import { cn } from '@/lib/cn';
import { siteConfig } from '@/lib/config';

/** The mark: a shield with a star. No likenesses, no borrowed logos. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('h-8 w-8', className)}>
      <path
        d="M32 6 54 14v18c0 12.5-8.8 21.9-22 26-13.2-4.1-22-13.5-22-26V14L32 6z"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path
        d="M32 20l3.3 7.2 7.7.9-5.7 5.4 1.5 7.7L32 37.4l-6.8 3.8 1.5-7.7-5.7-5.4 7.7-.9L32 20z"
        fill="currentColor"
      />
    </svg>
  );
}

export function BrandLock({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      <BrandMark className="h-7 w-7 text-brand" />
      <span className="text-base">
        Trump Strategy<span className="text-muted-foreground"> · {siteConfig.ticker}</span>
      </span>
    </span>
  );
}

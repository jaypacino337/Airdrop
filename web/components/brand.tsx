import { cn } from '@/lib/cn';

/** The mark: a stylised mRNA strand. Inline so it inherits currentColor. */
/** The mark: a capsule, half filled — pharma, not another crypto glyph. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('h-8 w-8', className)}>
      <g transform="rotate(-45 32 32)">
        <path
          d="M32 22h8a10 10 0 0 1 0 20h-8z"
          fill="currentColor"
        />
        <path
          d="M14 32a10 10 0 0 1 10-10h16a10 10 0 0 1 0 20H24a10 10 0 0 1-10-10z"
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
        />
        <path d="M32 22v20" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function BrandLock({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      <BrandMark className="h-7 w-7 text-brand" />
      <span className="text-base">
        Moderna<span className="text-muted-foreground"> · MRNA</span>
      </span>
    </span>
  );
}

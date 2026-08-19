import { cn } from '@/lib/cn';

/** The silhouette, shared by the mark and the favicon. */
const HORN_LEFT = 'M78 108C40 96 16 64 10 8C30 54 56 82 94 94Z';
const HORN_RIGHT = 'M122 108C160 96 184 64 190 8C170 54 144 82 106 94Z';
const HEAD = 'M58 64C62 104 70 142 82 170C86 178 114 178 118 170C130 142 138 104 142 64Z';

/**
 * The bull's head, filled with the flag: one flag is drawn across the whole
 * viewBox and clipped by the silhouette, which is why the canton lands on the
 * left horn and the stripes run straight across the head. The thin outline is
 * what keeps the white stripes readable against a white page.
 */
export function BullMark({ className, id = 'bull' }: { className?: string; id?: string }) {
  const clipId = `${id}-clip`;
  const starId = `${id}-stars`;

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="Trump Strategy" className={cn('h-9 w-9', className)}>
      <defs>
        <clipPath id={clipId}>
          <path d={HORN_LEFT} />
          <path d={HORN_RIGHT} />
          <path d={HEAD} />
        </clipPath>

        <pattern id={starId} width="26" height="22" patternUnits="userSpaceOnUse">
          <path
            d="M13 4.5l2.1 4.5 4.9.6-3.6 3.4 1 4.9L13 15.5 8.6 17.9l1-4.9L6 9.6l4.9-.6z"
            fill="#ffffff"
          />
        </pattern>
      </defs>

      {/* Keyline first: the clipped flag below covers every interior seam. */}
      <g fill="none" stroke="#16306b" strokeOpacity="0.6" strokeWidth="8" strokeLinejoin="round">
        <path d={HORN_LEFT} />
        <path d={HORN_RIGHT} />
        <path d={HEAD} />
      </g>

      <g clipPath={`url(#${clipId})`}>
        {/* 13 stripes, red on white */}
        <rect x="0" y="0" width="200" height="200" fill="#ffffff" />
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x="0" y={i * 30.8} width="200" height="15.4" fill="#d3202a" />
        ))}
        {/* canton */}
        <rect x="0" y="0" width="98" height="106" fill="#16306b" />
        <rect x="0" y="0" width="98" height="106" fill={`url(#${starId})`} />
      </g>

    </svg>
  );
}

/** The wordmark, letter-coloured like the logo: red -> white -> navy. */
export function Wordmark({
  className,
  stacked = false,
}: {
  className?: string;
  stacked?: boolean;
}) {
  return (
    <span className={cn('wordmark inline-block', className)}>
      <span className="whitespace-nowrap">
        <span className="ink-red">Tru</span>
        <span className="ink-white">m</span>
        <span className="ink-navy">p</span>
      </span>
      {stacked ? <br /> : <span> </span>}
      <span className="whitespace-nowrap">
        <span className="ink-navy">Stra</span>
        <span className="ink-white">te</span>
        <span className="ink-red">gy</span>
      </span>
    </span>
  );
}

/** Mark + wordmark, as used in the header and footer. */
export function BrandLock({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BullMark className="h-9 w-9 shrink-0" id="lock" />
      <Wordmark className="compact text-lg" />
    </span>
  );
}

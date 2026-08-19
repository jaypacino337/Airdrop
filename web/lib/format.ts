/** Raw base units -> a readable UI string. Uses BigInt so nothing overflows. */
export function formatRaw(
  raw: string | number | null | undefined,
  decimals: number,
  maxFraction = 2,
): string {
  const value = toBigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor)
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxFraction)
    .replace(/0+$/, '');
  const wholeText = whole.toLocaleString('en-US');
  return fraction ? `${wholeText}.${fraction}` : wholeText;
}

export function rawToNumber(raw: string | number | null | undefined, decimals: number): number {
  return Number(toBigInt(raw)) / 10 ** decimals;
}

export function toBigInt(raw: string | number | null | undefined): bigint {
  if (raw === null || raw === undefined || raw === '') return 0n;
  const text = String(raw).split('.')[0] ?? '0';
  try {
    return BigInt(text);
  } catch {
    return 0n;
  }
}

export function formatSol(lamports: string | number | null | undefined, digits = 3): string {
  const value = Number(toBigInt(lamports)) / 1e9;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function shortAddress(address: string, size = 4): string {
  if (!address) return '';
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function isSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  onAttemptFailed?: (attempt: number, error: unknown) => void;
}

/** Retry with exponential backoff + jitter. Throws the last error. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      opts.onAttemptFailed?.(attempt, err);
      if (attempt === attempts) break;
      const delay = Math.min(max, base * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (delay / 3));
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}

/** Split an array into fixed-size chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

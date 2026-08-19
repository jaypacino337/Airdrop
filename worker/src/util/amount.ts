/** Convert a UI amount ("500000.5") into raw base units for a given decimals. */
export function toRaw(ui: number | string, decimals: number): bigint {
  const text = typeof ui === 'number' ? ui.toFixed(decimals) : ui.trim();
  if (!/^\d*(\.\d*)?$/.test(text)) throw new Error(`Not a positive decimal amount: ${ui}`);
  const [whole = '0', fraction = ''] = text.split('.');
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

/** Raw base units -> a JS number in UI units. Display only; never for math. */
export function toUi(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Raw base units -> an exact decimal string in UI units. */
export function formatUi(raw: bigint, decimals: number, maxFractionDigits = decimals): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  let fraction = (abs % divisor).toString().padStart(decimals, '0').slice(0, maxFractionDigits);
  fraction = fraction.replace(/0+$/, '');
  const body = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${body}` : body;
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function lamportsToSol(lamports: bigint | number): number {
  return Number(lamports) / 1e9;
}

/**
 * Convert a compute-unit price into the flat SOL priority fee that
 * pump.fun-style APIs expect.
 */
export function priorityFeeSol(microLamportsPerCu: number, computeUnits = 200_000): number {
  const lamports = (microLamportsPerCu * computeUnits) / 1_000_000;
  return Number((lamports / 1e9).toFixed(9));
}

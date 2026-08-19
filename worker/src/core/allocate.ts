/**
 * Allocation rules
 * ----------------
 *  1. A wallet must hold at least `minBalanceRaw` of MRNA to be eligible.
 *  2. Excluded wallets (LP pools, CEX, treasury, the creator itself) never
 *     take part in a snapshot.
 *  3. Eligible wallets split the cycle's MRNAx pot pro-rata by MRNA held.
 *  4. No single wallet may take more than `maxShareBps` of the pot (4% by
 *     default). Whatever a capped wallet cannot take is redistributed
 *     pro-rata over the wallets that are still under the cap — repeatedly,
 *     because redistribution can push another wallet over the line.
 *
 * All arithmetic is integer (bigint) on raw base units. Rounding is always
 * down, so the sum of allocations is never greater than the pot; the
 * remainder ("dust") stays in the distributor wallet and rolls into the next
 * cycle.
 */

export interface HolderBalance {
  owner: string;
  balanceRaw: bigint;
}

export interface Allocation {
  owner: string;
  balanceRaw: bigint;
  amountRaw: bigint;
  /** Share of the pot in basis points (10000 = 100%). */
  shareBps: number;
  capped: boolean;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Everyone who passed the eligibility rules, largest balance first. */
  eligible: HolderBalance[];
  /** Eligible holders, including any whose allocation rounded to zero. */
  eligibleCount: number;
  cappedCount: number;
  /** Sum of the eligible wallets' balances. */
  eligibleBalanceRaw: bigint;
  /** Sum of everything actually allocated. */
  allocatedRaw: bigint;
  /** Pot minus allocated — rolls over to the next cycle. */
  dustRaw: bigint;
  /**
   * True when the cap had to be relaxed because there were too few eligible
   * wallets to hand out the whole pot under it (n * cap < 100%).
   */
  capRelaxed: boolean;
}

export interface AllocateOptions {
  potRaw: bigint;
  holders: readonly HolderBalance[];
  minBalanceRaw: bigint;
  maxShareBps: number;
  /** Allocations strictly below this are dropped (not worth the tx fee). */
  minPayoutRaw?: bigint;
  excluded?: ReadonlySet<string>;
}

const BPS = 10_000n;

export function allocate(opts: AllocateOptions): AllocationResult {
  const { potRaw, holders, minBalanceRaw, maxShareBps } = opts;
  const minPayoutRaw = opts.minPayoutRaw ?? 1n;
  const excluded = opts.excluded ?? new Set<string>();

  if (potRaw < 0n) throw new Error('potRaw must not be negative');
  if (maxShareBps < 1 || maxShareBps > 10_000) throw new Error('maxShareBps must be 1..10000');

  // 1 + 2 — eligibility.
  const eligible = holders
    .filter((h) => h.balanceRaw > 0n && h.balanceRaw >= minBalanceRaw && !excluded.has(h.owner))
    .sort((a, b) => (b.balanceRaw === a.balanceRaw ? (a.owner < b.owner ? -1 : 1) : b.balanceRaw > a.balanceRaw ? 1 : -1));

  const eligibleBalanceRaw = eligible.reduce((sum, h) => sum + h.balanceRaw, 0n);

  const empty: AllocationResult = {
    allocations: [],
    eligible,
    eligibleCount: eligible.length,
    cappedCount: 0,
    eligibleBalanceRaw,
    allocatedRaw: 0n,
    dustRaw: potRaw,
    capRelaxed: false,
  };

  if (eligible.length === 0 || eligibleBalanceRaw === 0n || potRaw === 0n) return empty;

  // 4 — the per-wallet ceiling, measured against the *whole* pot.
  const capRaw = (potRaw * BigInt(maxShareBps)) / BPS;

  // With very few holders the cap cannot mathematically absorb the pot
  // (e.g. 10 wallets x 4% = 40%). Fall back to pure pro-rata and say so.
  const capRelaxed = BigInt(eligible.length) * BigInt(maxShareBps) < BPS;

  const capped = new Map<string, bigint>();
  let active = [...eligible];
  let budget = potRaw;

  if (!capRelaxed) {
    // Repeat until a pass finds nobody new above the cap.
    for (;;) {
      const activeBalance = active.reduce((sum, h) => sum + h.balanceRaw, 0n);
      if (activeBalance === 0n) break;

      const over = active.filter((h) => (budget * h.balanceRaw) / activeBalance > capRaw);
      if (over.length === 0) break;

      for (const holder of over) {
        capped.set(holder.owner, capRaw);
        budget -= capRaw;
      }
      const overSet = new Set(over.map((h) => h.owner));
      active = active.filter((h) => !overSet.has(h.owner));

      if (active.length === 0 || budget <= 0n) break;
    }
  }

  const activeBalance = active.reduce((sum, h) => sum + h.balanceRaw, 0n);

  const allocations: Allocation[] = [];
  let allocatedRaw = 0n;

  for (const holder of eligible) {
    const cappedAmount = capped.get(holder.owner);
    const amountRaw =
      cappedAmount !== undefined
        ? cappedAmount
        : activeBalance > 0n && budget > 0n
          ? (budget * holder.balanceRaw) / activeBalance
          : 0n;

    if (amountRaw < minPayoutRaw) continue;

    allocations.push({
      owner: holder.owner,
      balanceRaw: holder.balanceRaw,
      amountRaw,
      shareBps: potRaw > 0n ? Number((amountRaw * BPS) / potRaw) : 0,
      capped: cappedAmount !== undefined,
    });
    allocatedRaw += amountRaw;
  }

  allocations.sort((a, b) => (b.amountRaw === a.amountRaw ? 0 : b.amountRaw > a.amountRaw ? 1 : -1));

  return {
    allocations,
    eligible,
    eligibleCount: eligible.length,
    cappedCount: capped.size,
    eligibleBalanceRaw,
    allocatedRaw,
    dustRaw: potRaw - allocatedRaw,
    capRelaxed,
  };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocate, type HolderBalance } from '../src/core/allocate.js';

const holders = (...balances: number[]): HolderBalance[] =>
  balances.map((b, i) => ({ owner: `wallet${i}`, balanceRaw: BigInt(b) }));

test('pro-rata split when nobody hits the cap', () => {
  const result = allocate({
    potRaw: 1_000_000n,
    holders: holders(100, 200, 700).map((h, i) => ({ ...h, owner: `w${i}` })),
    minBalanceRaw: 0n,
    maxShareBps: 10_000,
  });

  assert.equal(result.eligibleCount, 3);
  assert.equal(result.allocatedRaw, 1_000_000n);
  const byOwner = Object.fromEntries(result.allocations.map((a) => [a.owner, a.amountRaw]));
  assert.equal(byOwner.w0, 100_000n);
  assert.equal(byOwner.w1, 200_000n);
  assert.equal(byOwner.w2, 700_000n);
});

test('minimum balance filters out small holders', () => {
  const result = allocate({
    potRaw: 1_000n,
    holders: [
      { owner: 'big', balanceRaw: 500_000n },
      { owner: 'small', balanceRaw: 499_999n },
    ],
    minBalanceRaw: 500_000n,
    maxShareBps: 10_000,
  });

  assert.equal(result.eligibleCount, 1);
  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0]!.owner, 'big');
});

test('excluded wallets never receive anything', () => {
  const result = allocate({
    potRaw: 1_000n,
    holders: [
      { owner: 'lp-pool', balanceRaw: 900n },
      { owner: 'holder', balanceRaw: 100n },
    ],
    minBalanceRaw: 0n,
    maxShareBps: 10_000,
    excluded: new Set(['lp-pool']),
  });

  assert.equal(result.eligibleCount, 1);
  assert.equal(result.allocations[0]!.owner, 'holder');
  assert.equal(result.allocations[0]!.amountRaw, 1_000n);
});

test('a whale is capped at 4% and the excess is redistributed', () => {
  // One wallet holds 50% of the eligible supply; 30 wallets share the rest.
  const holderList: HolderBalance[] = [{ owner: 'whale', balanceRaw: 500n }];
  for (let i = 0; i < 30; i += 1) holderList.push({ owner: `w${i}`, balanceRaw: 500n / 30n + 1n });

  const result = allocate({
    potRaw: 10_000_000n,
    holders: holderList,
    minBalanceRaw: 0n,
    maxShareBps: 400,
  });

  const whale = result.allocations.find((a) => a.owner === 'whale')!;
  assert.equal(whale.capped, true);
  assert.equal(whale.amountRaw, 400_000n); // exactly 4% of the pot
  assert.ok(whale.shareBps <= 400);

  // Nobody exceeds the cap, and the pot is (almost exactly) fully allocated.
  for (const a of result.allocations) assert.ok(a.amountRaw <= 400_000n);
  assert.ok(result.allocatedRaw <= 10_000_000n);
  assert.ok(result.dustRaw < BigInt(result.allocations.length + 1));
});

test('capping cascades — redistribution can push the next wallet over the line', () => {
  // Two near-equal whales plus a long tail. Capping the first lifts the second
  // above 4%, which must then be capped too.
  const holderList: HolderBalance[] = [
    { owner: 'whale-a', balanceRaw: 300n },
    { owner: 'whale-b', balanceRaw: 290n },
  ];
  for (let i = 0; i < 60; i += 1) holderList.push({ owner: `w${i}`, balanceRaw: 10n });

  const result = allocate({
    potRaw: 1_000_000n,
    holders: holderList,
    minBalanceRaw: 0n,
    maxShareBps: 400,
  });

  assert.equal(result.cappedCount, 2);
  for (const a of result.allocations) assert.ok(a.amountRaw <= 40_000n, `${a.owner} exceeded the cap`);
});

test('cap is relaxed when too few wallets could absorb the pot', () => {
  const result = allocate({
    potRaw: 1_000n,
    holders: holders(1, 1, 1),
    minBalanceRaw: 0n,
    maxShareBps: 400, // 3 wallets x 4% = 12% — impossible
  });

  assert.equal(result.capRelaxed, true);
  assert.equal(result.cappedCount, 0);
  assert.equal(result.allocatedRaw, 999n); // integer rounding, dust rolls over
});

test('allocations below the minimum payout are dropped, not rounded up', () => {
  const result = allocate({
    potRaw: 100n,
    holders: [
      { owner: 'big', balanceRaw: 1_000_000n },
      { owner: 'dust', balanceRaw: 1n },
    ],
    minBalanceRaw: 0n,
    maxShareBps: 10_000,
    minPayoutRaw: 10n,
  });

  assert.equal(result.allocations.length, 1);
  assert.equal(result.allocations[0]!.owner, 'big');
  assert.ok(result.dustRaw >= 0n);
});

test('an empty pot or empty holder set is handled without throwing', () => {
  const noPot = allocate({ potRaw: 0n, holders: holders(1, 2), minBalanceRaw: 0n, maxShareBps: 400 });
  assert.equal(noPot.allocations.length, 0);
  assert.equal(noPot.dustRaw, 0n);

  const noHolders = allocate({ potRaw: 100n, holders: [], minBalanceRaw: 0n, maxShareBps: 400 });
  assert.equal(noHolders.allocations.length, 0);
  assert.equal(noHolders.dustRaw, 100n);
});

test('the sum of allocations never exceeds the pot', () => {
  const holderList: HolderBalance[] = [];
  for (let i = 0; i < 500; i += 1) {
    holderList.push({ owner: `w${i}`, balanceRaw: BigInt(1_000 + ((i * 7919) % 90_000)) });
  }
  const potRaw = 123_456_789_012n;
  const result = allocate({ potRaw, holders: holderList, minBalanceRaw: 0n, maxShareBps: 400 });
  const total = result.allocations.reduce((s, a) => s + a.amountRaw, 0n);
  assert.equal(total, result.allocatedRaw);
  assert.ok(total <= potRaw);
  assert.ok(potRaw - total < BigInt(result.allocations.length + 1));
});

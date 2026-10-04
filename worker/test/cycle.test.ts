import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { runCycle } from '../src/cycle.js';
import { pda } from './support/fake-chain.js';
import { harness, type Harness } from './support/context.js';

const UNIT = 1_000_000n; // the project mint has 6 decimals

/** 30 ordinary holders, one whale, one minnow under 500k, a pool PDA, and the treasury itself. */
function populate(h: Harness) {
  const holders: PublicKey[] = [];
  for (let i = 0; i < 30; i += 1) {
    const owner = Keypair.generate().publicKey;
    holders.push(owner);
    h.chain.setTokenBalance(h.project, owner, (600_000n + BigInt(i) * 10_000n) * UNIT);
  }
  const whale = Keypair.generate().publicKey;
  h.chain.setTokenBalance(h.project, whale, 40_000_000n * UNIT);
  const minnow = Keypair.generate().publicKey;
  h.chain.setTokenBalance(h.project, minnow, 499_999n * UNIT);
  const pool = pda('pumpswap-pool');
  h.chain.setTokenBalance(h.project, pool, 100_000_000n * UNIT);
  h.chain.setTokenBalance(h.project, h.treasury.publicKey, 5_000_000n * UNIT);
  return { holders, whale, minnow, pool };
}

test('a live cycle pays every eligible holder once, caps the whale at 4%, skips PDAs, minnows and the treasury', async () => {
  const h = await harness({ DRY_RUN: 'false' });
  const { holders, whale, minnow, pool } = populate(h);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 1_000_000_000n);

  const summary = await runCycle(h.ctx);

  assert.equal(summary.status, 'completed');
  assert.equal(summary.chainHeight, h.chain.slot);
  assert.equal(summary.eligibleCount, 31);
  assert.equal(summary.cappedCount, 1);
  const paid = h.repo.paidTo(h.reward.toBase58());
  assert.equal(paid.size, 31);
  assert.equal(paid.get(whale.toBase58()), 40_000_000n); // exactly 4% of the pot
  for (const owner of [minnow, pool, h.treasury.publicKey]) assert.ok(!paid.has(owner.toBase58()));
  for (const owner of holders) assert.equal(h.chain.tokenBalance(h.reward, owner), paid.get(owner.toBase58()));

  const total = [...paid.values()].reduce((s, v) => s + v, 0n);
  assert.ok(total <= 1_000_000_000n);
  assert.equal(h.chain.tokenBalance(h.reward, h.treasury.publicKey), 1_000_000_000n - total);

  const cycle = h.repo.cycles.get(summary.cycleId)!;
  assert.equal(cycle.status, 'completed');
  assert.equal(cycle.chain_height, h.chain.slot);
  assert.equal(cycle.payout_count, 31);
  assert.equal(h.repo.snapshots.get(summary.cycleId)!.length, 31);
});

test('a second cycle with an empty pot pays nobody twice', async () => {
  const h = await harness({ DRY_RUN: 'false' });
  populate(h);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 1_000_000_000n);
  await runCycle(h.ctx);
  const before = h.chain.transfers.length;

  const again = await runCycle(h.ctx);
  // Only rounding dust is left — far below one payout each.
  assert.equal(again.status, 'skipped');
  assert.equal(h.chain.transfers.length, before);
});

test('rows still owed from an earlier cycle are not counted as pot again', async () => {
  const h = await harness({ DRY_RUN: 'false', MAX_PAYOUTS_PER_CYCLE: '10' });
  populate(h);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 1_000_000_000n);

  const first = await runCycle(h.ctx);
  assert.equal(first.rewards[0]!.payoutCount, 10); // 21 rows left open
  const owed = await h.repo.outstandingRaw(h.reward.toBase58());
  assert.ok(owed > 0n);

  const second = await runCycle(h.ctx);
  // Balance minus what is still owed is only dust: nothing new is staged.
  assert.ok(BigInt(second.rewards[0]!.potRaw) < 100n);
  assert.equal(second.rewards[0]!.payoutCount, 10);
  await runCycle(h.ctx);
  await runCycle(h.ctx);

  const paid = h.repo.paidTo(h.reward.toBase58());
  assert.equal(paid.size, 31);
  assert.equal(await h.repo.outstandingRaw(h.reward.toBase58()), 0n);
  assert.ok(h.chain.tokenBalance(h.reward, h.treasury.publicKey) < 100n);
});

test('DRY_RUN (the default) computes and records the full allocation without moving anything', async () => {
  const h = await harness();
  populate(h);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 1_000_000_000n);

  const summary = await runCycle(h.ctx);
  assert.equal(summary.status, 'skipped');
  assert.equal(summary.eligibleCount, 31);
  assert.equal(h.chain.sent.length, 0);
  assert.equal(h.repo.payouts.length, 31);
  assert.ok(h.repo.payouts.every((p) => p.status === 'skipped'));
  assert.equal(h.chain.tokenBalance(h.reward, h.treasury.publicKey), 1_000_000_000n);
});

test('an RPC failure mid-cycle marks the cycle failed instead of throwing', async () => {
  const h = await harness({ DRY_RUN: 'false' });
  h.chain.getProgramAccounts = async () => {
    throw new Error('429 Too Many Requests');
  };
  const summary = await runCycle(h.ctx);
  assert.equal(summary.status, 'failed');
  assert.match(summary.error!, /429/);
  assert.equal(h.repo.cycles.get(summary.cycleId)!.status, 'failed');
});

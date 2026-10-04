import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { distribute } from '../src/services/distributor.js';
import { harness, type Harness } from './support/context.js';

const LIVE = { DRY_RUN: 'false' };

function seedRows(h: Harness, count: number, amount = 1_000n) {
  const owners = Array.from({ length: count }, () => Keypair.generate().publicKey);
  for (const owner of owners) h.repo.seed({ owner: owner.toBase58(), token: h.reward.toBase58(), amount_raw: amount.toString() });
  return owners;
}

test('dry run (the default) marks rows skipped and sends nothing', async () => {
  const h = await harness();
  assert.equal(h.ctx.env.DRY_RUN, true);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  seedRows(h, 3);

  const result = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  assert.equal(result.confirmed, 0);
  assert.equal(h.chain.sent.length, 0);
  assert.ok(h.repo.payouts.every((p) => p.status === 'skipped' && p.error === 'dry run'));
});

test('switching back to dry run never forgets a live batch that may still land', async () => {
  const live = await harness(LIVE);
  live.chain.setTokenBalance(live.reward, live.treasury.publicKey, 10_000n);
  seedRows(live, 1);
  live.chain.onSend = () => 'lost';
  await distribute(live.ctx, live.ctx.rewards[0]!, 'c1');
  const signed = live.repo.payouts[0]!;
  assert.equal(signed.status, 'sent');

  const dry = { ...live.ctx, env: { ...live.ctx.env, DRY_RUN: true } };
  live.repo.seed({ owner: Keypair.generate().publicKey.toBase58(), token: live.reward.toBase58(), amount_raw: '5' });
  await distribute(dry, dry.rewards[0]!, 'c2');
  assert.equal(live.repo.payouts[0]!.status, 'sent');
  assert.equal(live.repo.payouts[0]!.tx_id, signed.tx_id);
  assert.equal(live.repo.payouts[1]!.status, 'skipped');
});

test('pays in batches, creates missing token accounts, and writes each signature before broadcasting it', async () => {
  const h = await harness(LIVE);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  const owners = seedRows(h, 6);
  // One recipient already has a token account; the rest need one created.
  h.chain.setTokenBalance(h.reward, owners[0]!, 5n);
  const journal: string[] = [];
  h.chain.journal = journal;
  h.repo.journal = journal;

  const result = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');

  assert.equal(result.confirmed, 6);
  assert.equal(result.failed, 0);
  assert.equal(result.txCount, 2); // PAYOUT_BATCH_SIZE=4 → 4 + 2
  assert.equal(result.distributedRaw, 6_000n);
  assert.equal(h.chain.tokenBalance(h.reward, h.treasury.publicKey), 4_000n);
  assert.equal(h.chain.tokenBalance(h.reward, owners[0]!), 1_005n);
  for (const owner of owners.slice(1)) assert.equal(h.chain.tokenBalance(h.reward, owner), 1_000n);
  assert.ok(h.chain.transfers.every((t) => t.programId === TOKEN_PROGRAM_ID.toBase58()));
  assert.ok(h.repo.payouts.every((p) => p.status === 'confirmed' && p.tx_id));

  // Ledger-before-network: every signature reaches the ledger before the RPC.
  assert.equal(h.chain.sent.length, 2);
  for (const signature of h.chain.sent) {
    const ledgerAt = journal.findIndex((line) => line.endsWith(`:sent:${signature}`));
    const broadcastAt = journal.indexOf(`broadcast:${signature}`);
    assert.ok(ledgerAt >= 0 && broadcastAt > ledgerAt, 'signature written to the ledger before broadcast');
  }
});

test('Token-2022 reward mints are transferred with the Token-2022 program', async () => {
  const h = await harness(LIVE, { rewardToken2022: true });
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  seedRows(h, 2);
  const result = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  assert.equal(result.confirmed, 2);
  assert.ok(h.chain.transfers.every((t) => t.programId === TOKEN_2022_PROGRAM_ID.toBase58()));
});

test('crash after broadcast: a row whose signature already landed is marked paid, never resent', async () => {
  const h = await harness(LIVE);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  seedRows(h, 2);

  // First run: the tx lands but the connection drops before we hear back.
  h.chain.onSend = () => 'drop-after-landing';
  const first = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  assert.equal(first.confirmed, 0);
  assert.ok(h.repo.payouts.every((p) => p.status === 'sent' && p.tx_id));
  assert.equal(h.chain.tokenBalance(h.reward, h.treasury.publicKey), 8_000n);

  // Restart: reconcile finds the signature on chain.
  h.chain.onSend = null;
  const second = await distribute(h.ctx, h.ctx.rewards[0]!, 'c2');
  assert.equal(second.confirmed, 2);
  assert.equal(second.txCount, 0);
  assert.equal(h.chain.sent.length, 1, 'nothing was broadcast twice');
  assert.equal(h.chain.tokenBalance(h.reward, h.treasury.publicKey), 8_000n);
  assert.ok(h.repo.payouts.every((p) => p.status === 'confirmed'));
});

test('unknown outcome: not resent while the blockhash is valid, resent exactly once after it expires', async () => {
  const h = await harness(LIVE);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  const [owner] = seedRows(h, 1);

  h.chain.onSend = () => 'lost'; // the RPC never saw it
  await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  const row = h.repo.payouts[0]!;
  assert.equal(row.status, 'sent');
  const firstSignature = row.tx_id!;

  // Next cycle, same block height: it could still land — leave it alone.
  h.chain.onSend = null;
  const waiting = await distribute(h.ctx, h.ctx.rewards[0]!, 'c2');
  assert.equal(waiting.txCount, 0);
  assert.equal(h.repo.payouts[0]!.tx_id, firstSignature);

  // Past its last valid height it can never land: now resend.
  h.chain.blockHeight = row.last_valid_height! + 1;
  const resent = await distribute(h.ctx, h.ctx.rewards[0]!, 'c3');
  assert.equal(resent.confirmed, 1);
  assert.equal(resent.txCount, 1);
  assert.notEqual(h.repo.payouts[0]!.tx_id, firstSignature);
  assert.equal(h.chain.tokenBalance(h.reward, owner!), 1_000n);
});

test('a transaction that landed but failed on chain is resent', async () => {
  const h = await harness(LIVE);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  const [owner] = seedRows(h, 1);

  h.chain.onSend = () => 'fail';
  const first = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  assert.equal(first.failed, 1);
  assert.equal(h.repo.payouts[0]!.status, 'failed');
  assert.equal(h.repo.payouts[0]!.tx_id, null);

  h.chain.onSend = null;
  const second = await distribute(h.ctx, h.ctx.rewards[0]!, 'c2');
  assert.equal(second.confirmed, 1);
  assert.equal(h.chain.tokenBalance(h.reward, owner!), 1_000n);
});

test('a preflight rejection fails only that batch; the next batch still goes out', async () => {
  const h = await harness({ ...LIVE, PAYOUT_BATCH_SIZE: '1' });
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  seedRows(h, 3);
  let calls = 0;
  h.chain.onSend = () => (calls++ === 0 ? 'reject' : 'land');

  const result = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  assert.equal(result.failed, 1);
  assert.equal(result.confirmed, 2);
  assert.deepEqual(
    h.repo.payouts.map((p) => p.status),
    ['failed', 'confirmed', 'confirmed'],
  );
  assert.match(h.repo.payouts[0]!.error!, /Simulation failed/);
});

test('postpones (sends nothing) when the treasury cannot cover fees and new token accounts', async () => {
  const h = await harness(LIVE);
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  h.chain.setSol(h.treasury.publicKey, 1_000_000); // 0.001 SOL < 3 × ATA rent
  seedRows(h, 3);

  const result = await distribute(h.ctx, h.ctx.rewards[0]!, 'c1');
  assert.equal(h.chain.sent.length, 0);
  assert.match(result.note!, /needs ~0\.006/);
  assert.ok(h.repo.payouts.every((p) => p.status === 'pending'));
});

test('MAX_PAYOUTS_PER_CYCLE caps a run; the rest resume next cycle', async () => {
  const h = await harness({ ...LIVE, MAX_PAYOUTS_PER_CYCLE: '3' });
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 10_000n);
  seedRows(h, 5);
  assert.equal((await distribute(h.ctx, h.ctx.rewards[0]!, 'c1')).confirmed, 3);
  assert.equal((await distribute(h.ctx, h.ctx.rewards[0]!, 'c2')).confirmed, 2);
  assert.equal(h.chain.tokenBalance(h.reward, h.treasury.publicKey), 5_000n);
});

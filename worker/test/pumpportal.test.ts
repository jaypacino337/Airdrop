import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { PUMPPORTAL_LOCAL, pumpCreatorVault } from '../src/chain/solana.js';
import { claimCreatorFees } from '../src/services/fees.js';
import { buyRewardToken } from '../src/services/swap.js';
import { harness } from './support/context.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** What PumpPortal's trade-local returns: an unsigned v0 transaction for `payer`. */
function unsignedTx(payer: PublicKey): Uint8Array {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })],
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

function mockPumpPortal(payer: PublicKey, requests: Array<Record<string, unknown>>, status = 200) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, PUMPPORTAL_LOCAL);
    requests.push(JSON.parse(String(init.body)));
    return status === 200 ? new Response(unsignedTx(payer)) : new Response('Bad Request', { status });
  }) as typeof fetch;
}

// --- fee income: pump.fun creator fees --------------------------------------

test('FEE_CLAIM=disabled does nothing', async () => {
  const h = await harness({ FEE_CLAIM: 'disabled' });
  assert.equal((await claimCreatorFees(h.ctx)).status, 'disabled');
});

test('dry run reports what is claimable from the creator vault without claiming', async () => {
  const h = await harness({ FEE_CLAIM: 'pumpfun' });
  h.chain.setSol(pumpCreatorVault(h.treasury.publicKey), 890_880 + 250_000_000); // rent + 0.25 SOL
  const requests: Array<Record<string, unknown>> = [];
  mockPumpPortal(h.treasury.publicKey, requests);

  const result = await claimCreatorFees(h.ctx);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'dry run');
  assert.equal(result.claimableRaw, 250_000_000n);
  assert.equal(requests.length, 0);
});

test('below MIN_CLAIM_LAMPORTS the fees roll over', async () => {
  const h = await harness({ FEE_CLAIM: 'pumpfun', DRY_RUN: 'false' });
  h.chain.setSol(pumpCreatorVault(h.treasury.publicKey), 890_880 + 1_000);
  const result = await claimCreatorFees(h.ctx);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason!, /MIN_CLAIM_LAMPORTS/);
});

test('live claim: asks PumpPortal for collectCreatorFee, signs locally, reports what landed', async () => {
  const h = await harness({ FEE_CLAIM: 'pumpfun', DRY_RUN: 'false' });
  const vault = pumpCreatorVault(h.treasury.publicKey);
  h.chain.setSol(vault, 890_880 + 300_000_000);
  const requests: Array<Record<string, unknown>> = [];
  mockPumpPortal(h.treasury.publicKey, requests);
  h.chain.onVersioned = (tx) => {
    assert.equal(tx.signatures.length, 1);
    assert.ok(tx.signatures[0]!.some((b) => b !== 0), 'signed by the treasury');
    h.chain.setSol(vault, 890_880);
    h.chain.setSol(h.treasury.publicKey, h.chain.sol(h.treasury.publicKey) + 300_000_000 - 5_000);
  };

  const result = await claimCreatorFees(h.ctx);
  assert.equal(result.status, 'claimed');
  assert.equal(result.claimedRaw, 299_995_000n);
  assert.ok(result.txId);
  assert.deepEqual(requests[0], {
    publicKey: h.treasury.publicKey.toBase58(),
    action: 'collectCreatorFee',
    priorityFee: 0.00005,
    pool: 'pump',
  });
});

test('refuses to sign a PumpPortal transaction paid by someone else', async () => {
  const h = await harness({ FEE_CLAIM: 'pumpfun', DRY_RUN: 'false' });
  h.chain.setSol(pumpCreatorVault(h.treasury.publicKey), 890_880 + 300_000_000);
  mockPumpPortal(Keypair.generate().publicKey, []);
  const result = await claimCreatorFees(h.ctx);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason!, /fee payer is not the treasury/);
  assert.equal(h.chain.journal.filter((l) => l.startsWith('versioned:')).length, 0);
});

test('a PumpPortal outage skips the claim instead of failing the cycle', async () => {
  const h = await harness({ FEE_CLAIM: 'pumpfun', DRY_RUN: 'false' });
  h.chain.setSol(pumpCreatorVault(h.treasury.publicKey), 890_880 + 300_000_000);
  mockPumpPortal(h.treasury.publicKey, [], 400);
  const result = await claimCreatorFees(h.ctx);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason!, /PumpPortal collectCreatorFee failed \(400\)/);
});

// --- buyback: SOL -> reward token ---------------------------------------------

test('SWAP_PROVIDER=disabled (the default) never buys', async () => {
  const h = await harness({ DRY_RUN: 'false' });
  const result = await buyRewardToken(h.ctx, h.ctx.rewards[0]!, 500_000_000n);
  assert.equal(result.status, 'disabled');
});

test('buy: below the minimum rolls over, dry run does not trade', async () => {
  const dry = await harness({ SWAP_PROVIDER: 'pumpportal' });
  assert.equal((await buyRewardToken(dry.ctx, dry.ctx.rewards[0]!, 500_000_000n)).reason, 'dry run');
  const live = await harness({ SWAP_PROVIDER: 'pumpportal', DRY_RUN: 'false' });
  assert.match((await buyRewardToken(live.ctx, live.ctx.rewards[0]!, 1_000n)).reason!, /MIN_SWAP_LAMPORTS/);
});

test('live buy: SOL amount, slippage percent and pool go to PumpPortal; only the delta counts as bought', async () => {
  const h = await harness({ SWAP_PROVIDER: 'pumpportal', DRY_RUN: 'false', SWAP_SLIPPAGE_BPS: '1500', SWAP_POOL: 'pump-amm' });
  h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 7_000n); // held before: never counted
  const requests: Array<Record<string, unknown>> = [];
  mockPumpPortal(h.treasury.publicKey, requests);
  h.chain.onVersioned = () => h.chain.setTokenBalance(h.reward, h.treasury.publicKey, 7_000n + 123_456n);

  const result = await buyRewardToken(h.ctx, h.ctx.rewards[0]!, 250_000_000n);
  assert.equal(result.status, 'swapped');
  assert.equal(result.boughtRaw, 123_456n);
  assert.equal(result.nativeSpent, 250_000_000n);
  assert.deepEqual(requests[0], {
    publicKey: h.treasury.publicKey.toBase58(),
    action: 'buy',
    mint: h.reward.toBase58(),
    amount: 0.25,
    denominatedInSol: 'true',
    slippage: 15,
    priorityFee: 0.00005,
    pool: 'pump-amm',
  });
});

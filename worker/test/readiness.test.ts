import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { checkReadiness } from '../src/readiness.js';
import { makeEnv } from './support/context.js';

const REWARD = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USTR = Keypair.generate().publicKey.toBase58();
const KEY = Keypair.generate().secretKey;

test('a deploy with only Supabase configured is not ready, but says why', () => {
  const result = checkReadiness(makeEnv());
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 4);
});

test('a fully configured deploy is ready — base58 key', () => {
  const result = checkReadiness(
    makeEnv({
      SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x',
      TREASURY_SECRET_KEY: bs58.encode(KEY),
      PROJECT_TOKEN_MINT: USTR,
      REWARD_TOKENS: `URANIUM:${REWARD}:10000`,
    }),
  );
  assert.deepEqual(result, { ready: true, missing: [] });
});

test('a solana-keygen JSON byte-array key is accepted too', () => {
  const result = checkReadiness(
    makeEnv({
      SOLANA_RPC_URL: 'http://127.0.0.1:8899',
      TREASURY_SECRET_KEY: JSON.stringify(Array.from(KEY)),
      PROJECT_TOKEN_MINT: USTR,
      REWARD_TOKENS: `URANIUM:${REWARD}:10000`,
    }),
  );
  assert.equal(result.ready, true);
});

test('malformed keys and addresses — including leftover EVM values — are reported, not thrown', () => {
  const result = checkReadiness(
    makeEnv({
      SOLANA_RPC_URL: 'https://rpc.example.com',
      TREASURY_SECRET_KEY: '0x' + 'ab'.repeat(32),
      PROJECT_TOKEN_MINT: '0xcccccccccccccccccccccccccccccccccccccccc',
      REWARD_TOKENS: `A:${REWARD}:9000`,
    }),
  );
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 3);
  assert.ok(result.missing.some((m) => m.includes('64-byte secret key')));
  assert.ok(result.missing.some((m) => m.includes('valid base58 Solana address')));
  assert.ok(result.missing.some((m) => m.includes('must total 10000')));
});

test('defaults keep the documented rules: dry run on, 500k minimum, 4% cap, 5-minute cycle', () => {
  const env = makeEnv();
  assert.equal(env.DRY_RUN, true);
  assert.equal(env.MIN_ELIGIBLE_TOKENS, 500_000);
  assert.equal(env.MAX_WALLET_SHARE_BPS, 400);
  assert.equal(env.CYCLE_INTERVAL_MS, 300_000);
  assert.equal(env.SWAP_PROVIDER, 'disabled');
});

test('excluded wallets keep their case (base58 is case-sensitive)', () => {
  const env = makeEnv({ EXCLUDED_WALLETS: `${USTR}, ${REWARD}` });
  assert.deepEqual(env.EXCLUDED_WALLETS, [USTR, REWARD]);
});

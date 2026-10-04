import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkReadiness } from '../src/readiness.js';
import type { Env } from '../src/env.js';

const XU = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const USTR = '0xcccccccccccccccccccccccccccccccccccccccc';
const KEY = '0x' + 'ab'.repeat(32);

const base = (overrides: Partial<Env> = {}): Env =>
  ({
    EVM_RPC_URL: '',
    TREASURY_PRIVATE_KEY: '',
    PROJECT_TOKEN_ADDRESS: '',
    REWARD_TOKENS: '',
    ...overrides,
  }) as Env;

test('a deploy with only Supabase configured is not ready, but says why', () => {
  const result = checkReadiness(base());
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 4);
});

test('a fully configured deploy is ready', () => {
  const result = checkReadiness(
    base({
      EVM_RPC_URL: 'https://rpc.example.com',
      TREASURY_PRIVATE_KEY: KEY,
      PROJECT_TOKEN_ADDRESS: USTR,
      REWARD_TOKENS: `xU3O8:${XU}:10000`,
    }),
  );
  assert.deepEqual(result, { ready: true, missing: [] });
});

test('a malformed key or address is reported rather than thrown', () => {
  const result = checkReadiness(
    base({
      EVM_RPC_URL: 'https://rpc.example.com',
      TREASURY_PRIVATE_KEY: 'not-a-key',
      PROJECT_TOKEN_ADDRESS: 'not-an-address',
      REWARD_TOKENS: `A:${XU}:9000`,
    }),
  );
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 3);
  assert.ok(result.missing.some((m) => m.includes('32-byte hex key')));
  assert.ok(result.missing.some((m) => m.includes('valid 0x address')));
  assert.ok(result.missing.some((m) => m.includes('must total 10000')));
});

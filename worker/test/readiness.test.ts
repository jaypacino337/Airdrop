import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkReadiness } from '../src/readiness.js';
import type { Env } from '../src/env.js';

const WLFI = 'AhK7sMoLQmQEtiRNr4xqCsUGwT4tBAr9UQwHQvPTQGeD';
const TRUMP = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';
const PROJECT = '9nEqaUcb16sQ3Tn1psbkWqyhPdLmfHWjKGymREjsAgTE';

const base = (overrides: Partial<Env> = {}): Env =>
  ({
    CREATOR_PRIVATE_KEY: '',
    PROJECT_TOKEN_MINT: '',
    REWARD_TOKENS: '',
    ...overrides,
  }) as Env;

test('a deploy with only Supabase configured is not ready, but says why', () => {
  const result = checkReadiness(base());
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 3);
  assert.ok(result.missing.some((m) => m.startsWith('CREATOR_PRIVATE_KEY')));
  assert.ok(result.missing.some((m) => m.startsWith('PROJECT_TOKEN_MINT')));
  assert.ok(result.missing.some((m) => m.startsWith('REWARD_TOKENS')));
});

test('a fully configured deploy is ready', () => {
  const result = checkReadiness(
    base({
      CREATOR_PRIVATE_KEY: 'x'.repeat(80),
      PROJECT_TOKEN_MINT: PROJECT,
      REWARD_TOKENS: `WLFI:${WLFI}:5000,TRUMP:${TRUMP}:5000`,
    }),
  );
  assert.deepEqual(result, { ready: true, missing: [] });
});

test('a malformed mint is reported rather than thrown', () => {
  const result = checkReadiness(
    base({
      CREATOR_PRIVATE_KEY: 'x'.repeat(80),
      PROJECT_TOKEN_MINT: 'nope',
      REWARD_TOKENS: `WLFI:${WLFI}:10000`,
    }),
  );
  assert.equal(result.ready, false);
  assert.ok(result.missing[0]!.includes('not a valid base58'));
});

test('bad reward weights are reported rather than thrown', () => {
  const result = checkReadiness(
    base({
      CREATOR_PRIVATE_KEY: 'x'.repeat(80),
      PROJECT_TOKEN_MINT: PROJECT,
      REWARD_TOKENS: `WLFI:${WLFI}:5000,TRUMP:${TRUMP}:4000`,
    }),
  );
  assert.equal(result.ready, false);
  assert.ok(result.missing[0]!.includes('must total 10000'));
});

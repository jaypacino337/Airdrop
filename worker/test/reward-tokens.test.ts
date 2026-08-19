import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRewardTokens } from '../src/env.js';

const WLFI = 'AhK7sMoLQmQEtiRNr4xqCsUGwT4tBAr9UQwHQvPTQGeD';
const TRUMP = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN';

test('parses a 50/50 split', () => {
  const tokens = parseRewardTokens(`WLFI:${WLFI}:5000, TRUMP:${TRUMP}:5000`);
  assert.equal(tokens.length, 2);
  assert.deepEqual(tokens[0], { symbol: 'WLFI', mint: WLFI, weightBps: 5000 });
  assert.deepEqual(tokens[1], { symbol: 'TRUMP', mint: TRUMP, weightBps: 5000 });
});

test('rejects weights that do not total 100%', () => {
  assert.throws(
    () => parseRewardTokens(`WLFI:${WLFI}:5000,TRUMP:${TRUMP}:4000`),
    /must total 10000/,
  );
});

test('rejects a duplicated mint', () => {
  assert.throws(() => parseRewardTokens(`WLFI:${WLFI}:5000,ALSO:${WLFI}:5000`), /same mint twice/);
});

test('rejects a malformed mint', () => {
  assert.throws(() => parseRewardTokens('WLFI:not-a-mint:10000'), /valid base58 mint/);
});

test('rejects a missing or zero weight', () => {
  assert.throws(() => parseRewardTokens(`WLFI:${WLFI}`), /positive integer weight/);
  assert.throws(() => parseRewardTokens(`WLFI:${WLFI}:0`), /positive integer weight/);
});

test('a single token at 100% is valid', () => {
  const tokens = parseRewardTokens(`TRUMP:${TRUMP}:10000`);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.weightBps, 10_000);
});

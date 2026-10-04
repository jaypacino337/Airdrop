import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRewardTokens } from '../src/env.js';

const XU = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const NNE = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';

test('parses a single uranium token at 100%', () => {
  const tokens = parseRewardTokens(`xU3O8:${XU}:10000`);
  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0], { symbol: 'xU3O8', token: XU.toLowerCase(), weightBps: 10_000 });
});

test('parses a split and lowercases addresses', () => {
  const tokens = parseRewardTokens(`XU3O8:${XU}:5000, NNE:${NNE}:5000`);
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]!.token, XU.toLowerCase());
  assert.equal(tokens[1]!.symbol, 'NNE');
});

test('rejects weights that do not total 100%', () => {
  assert.throws(() => parseRewardTokens(`A:${XU}:5000,B:${NNE}:4000`), /must total 10000/);
});

test('rejects a duplicated token', () => {
  assert.throws(() => parseRewardTokens(`A:${XU}:5000,B:${XU}:5000`), /same token twice/);
});

test('rejects a malformed address', () => {
  assert.throws(() => parseRewardTokens('A:0x1234:10000'), /valid 0x address/);
});

test('rejects a missing or zero weight', () => {
  assert.throws(() => parseRewardTokens(`A:${XU}`), /positive integer weight/);
  assert.throws(() => parseRewardTokens(`A:${XU}:0`), /positive integer weight/);
});

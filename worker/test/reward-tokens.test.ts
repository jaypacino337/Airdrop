import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRewardTokens } from '../src/env.js';

// Real mainnet mints, only used as well-formed base58 strings here.
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

test('parses a single reward token at 100%', () => {
  const tokens = parseRewardTokens(`URANIUM:${USDC}:10000`);
  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0], { symbol: 'URANIUM', mint: USDC, weightBps: 10_000 });
});

test('parses a split and keeps base58 case exactly as written', () => {
  const tokens = parseRewardTokens(`A:${USDC}:5000, B:${WSOL}:5000`);
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]!.mint, USDC);
  assert.equal(tokens[1]!.symbol, 'B');
  assert.equal(tokens[1]!.mint, WSOL);
});

test('rejects weights that do not total 100%', () => {
  assert.throws(() => parseRewardTokens(`A:${USDC}:5000,B:${WSOL}:4000`), /must total 10000/);
});

test('rejects a duplicated token', () => {
  assert.throws(() => parseRewardTokens(`A:${USDC}:5000,B:${USDC}:5000`), /same token twice/);
});

test('rejects a malformed or EVM-style address', () => {
  assert.throws(() => parseRewardTokens('A:0x1234:10000'), /valid base58 mint/);
  assert.throws(() => parseRewardTokens(`A:0x${'ab'.repeat(20)}:10000`), /valid base58 mint/);
  // 0, O, I and l are not in the base58 alphabet.
  assert.throws(() => parseRewardTokens(`A:${USDC.replace('E', '0')}:10000`), /valid base58 mint/);
});

test('rejects a missing or zero weight', () => {
  assert.throws(() => parseRewardTokens(`A:${USDC}`), /positive integer weight/);
  assert.throws(() => parseRewardTokens(`A:${USDC}:0`), /positive integer weight/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUi, priorityFeeSol, toRaw, toUi } from '../src/util/amount.js';

test('toRaw converts UI amounts without floating point drift', () => {
  assert.equal(toRaw('500000', 6), 500_000_000_000n);
  assert.equal(toRaw('0.000001', 6), 1n);
  assert.equal(toRaw('1.23456789', 6), 1_234_567n); // truncates, never rounds up
  assert.equal(toRaw(500_000, 9), 500_000_000_000_000n);
});

test('formatUi round-trips raw amounts', () => {
  assert.equal(formatUi(500_000_000_000n, 6), '500000');
  assert.equal(formatUi(1_234_567n, 6), '1.234567');
  assert.equal(formatUi(1_234_567n, 6, 2), '1.23');
  assert.equal(formatUi(0n, 6), '0');
});

test('toUi is display-only but stays exact for sane magnitudes', () => {
  assert.equal(toUi(1_500_000n, 6), 1.5);
});

test('priorityFeeSol turns a compute unit price into SOL', () => {
  assert.equal(priorityFeeSol(250_000, 200_000), 0.00005);
  assert.equal(priorityFeeSol(0), 0);
});

test('toRaw rejects nonsense', () => {
  assert.throws(() => toRaw('abc', 6));
  assert.throws(() => toRaw('-1', 6));
});

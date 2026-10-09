import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPow, solvePowSync } from '../src/pow/pow.js';

const PREFIX = 'deadbeefcafef00d:verify:10:test:';

test('solved proofs verify', () => {
  const nonces = solvePowSync(PREFIX, 10, 4);
  assert.equal(nonces.length, 4);
  assert.equal(checkPow(PREFIX, 10, 4, nonces), true);
});

test('proofs are bound to their prefix and difficulty', () => {
  const nonces = solvePowSync(PREFIX, 10, 4);
  assert.equal(checkPow(PREFIX.replace('verify', 'reload'), 10, 4, nonces), false);
  // A proof for 10 bits is very unlikely to also satisfy 20 bits.
  assert.equal(checkPow(PREFIX, 20, 4, nonces), false);
});

test('malformed proofs are rejected', () => {
  const nonces = solvePowSync(PREFIX, 8, 4);
  assert.equal(checkPow(PREFIX, 8, 4, nonces.slice(0, 3)), false); // too few
  assert.equal(checkPow(PREFIX, 8, 4, [nonces[0], nonces[0], nonces[1], nonces[2]]), false); // duplicates
  assert.equal(checkPow(PREFIX, 8, 4, [...nonces.slice(0, 3), -1]), false); // negative
  assert.equal(checkPow(PREFIX, 8, 4, [...nonces.slice(0, 3), 1.5]), false); // not an integer
  assert.equal(checkPow(PREFIX, 8, 4, 'nope'), false);
});

test('invalid parameters throw', () => {
  assert.throws(() => checkPow(PREFIX, 0, 4, []), RangeError);
  assert.throws(() => checkPow(PREFIX, 32, 4, []), RangeError);
  assert.throws(() => solvePowSync(PREFIX, 8, 0), RangeError);
});

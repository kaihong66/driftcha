import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoiseRng, secureCode, secureHex, secureInt } from '../src/core/random.js';

test('secureInt stays in range and covers it', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const n = secureInt(10);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 10);
    seen.add(n);
  }
  assert.equal(seen.size, 10);
});

test('secureCode has the requested length and no leading zero', () => {
  for (let i = 0; i < 500; i++) {
    const code = secureCode(4);
    assert.match(code, /^[1-9]\d{3}$/);
  }
  assert.match(secureCode(6), /^[1-9]\d{5}$/);
});

test('secureHex returns two hex chars per byte', () => {
  assert.match(secureHex(8), /^[0-9a-f]{16}$/);
});

test('NoiseRng produces floats in [0, 1) and reseeds', () => {
  const rng = new NoiseRng();
  for (let i = 0; i < 10000; i++) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1);
  }
  const a = [rng.u32(), rng.u32(), rng.u32()];
  rng.reseed();
  const b = [rng.u32(), rng.u32(), rng.u32()];
  assert.notDeepEqual(a, b);
});

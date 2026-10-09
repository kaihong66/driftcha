import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame } from '../src/core/codec.js';

const N = 260 * 120;
const WHITE = 0xffffffff,
  BLACK = 0xff000000;

function monoFrame(seed) {
  const px = new Uint32Array(N);
  for (let i = 0; i < N; i++) px[i] = ((i * 2654435761 + seed) >>> 13) & 1 ? WHITE : BLACK;
  return px;
}

test('mono frames round-trip exactly', () => {
  const px = monoFrame(7);
  const encoded = encodeFrame(px, false);
  assert.equal(encoded.length, 5 + N / 8);
  const out = new Uint32Array(N);
  assert.equal(new FrameDecoder().push(encoded, out), true);
  assert.deepEqual(out, px);
});

test('colour frames round-trip within RGB332 precision', () => {
  const px = new Uint32Array(N);
  for (let i = 0; i < N; i++) px[i] = (0xff000000 | ((i * 40503) & 0xffffff)) >>> 0;
  const out = new Uint32Array(N);
  new FrameDecoder().push(encodeFrame(px, true), out);
  for (let i = 0; i < N; i += 97) {
    const a = px[i],
      b = out[i];
    assert.ok(Math.abs((a & 0xff) - (b & 0xff)) <= 36, 'red');
    assert.ok(Math.abs(((a >>> 8) & 0xff) - ((b >>> 8) & 0xff)) <= 36, 'green');
    assert.ok(Math.abs(((a >>> 16) & 0xff) - ((b >>> 16) & 0xff)) <= 85, 'blue');
    assert.equal(b >>> 24, 0xff);
  }
});

test('frames split across arbitrary chunks decode; the newest complete frame wins', () => {
  const first = monoFrame(1),
    second = monoFrame(2);
  const bytes = new Uint8Array([...encodeFrame(first, false), ...encodeFrame(second, false)]);
  const decoder = new FrameDecoder();
  const out = new Uint32Array(N);

  // Half of the first frame: nothing yet.
  assert.equal(decoder.push(bytes.subarray(0, 1000), out), false);
  // The rest of everything at once: only the second frame is decoded.
  assert.equal(decoder.push(bytes.subarray(1000), out), true);
  assert.deepEqual(out, second);
});

test('corrupt streams are rejected', () => {
  const bad = new Uint8Array([0, 0, 0, 0, 1]);
  assert.throws(() => new FrameDecoder().push(bad, new Uint32Array(N)));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVectorBlobMask, makeVectorDigitMask, vectorGlyphs } from '../src/core/vector-glyphs.js';
import { NoiseRng } from '../src/core/random.js';
import { Scene } from '../src/core/scene.js';
import { distortionOf, randomDistortion } from '../src/core/mask.js';
import { DEFAULT_STAGES, FIELD } from '../src/config.js';

const rng = new NoiseRng();
const area = m => m.mask.reduce((sum, v) => sum + v, 0);
const meanWidth = (digit, stage, n = 200) => {
  let total = 0;
  for (let i = 0; i < n; i++) total += makeVectorDigitMask(digit, rng, stage).w;
  return total / n;
};

test('every digit rasterizes to a reasonably sized mask', () => {
  for (const digit of '0123456789') {
    for (let i = 0; i < 25; i++) {
      const m = makeVectorDigitMask(digit, rng, { tilt: 12, distortion: 1 });
      assert.ok(area(m) > 150, `digit ${digit} too thin`);
      assert.ok(m.w <= 96 && m.h <= 104);
      assert.ok(m.h >= 40, `digit ${digit} too short`);
    }
  }
});

test('"1" is a single narrow stroke, much narrower than "0"', () => {
  const stage = { tilt: 0, distortion: 1 };
  assert.ok(meanWidth('1', stage) < meanWidth('0', stage) * 0.7);
});

test('distortion is clamped to 0..1 and off by default', () => {
  assert.equal(distortionOf({}), 0);
  assert.equal(distortionOf(undefined), 0);
  assert.equal(distortionOf({ distortion: 0.4 }), 0.4);
  assert.equal(distortionOf({ distortion: 3 }), 1);
  assert.equal(distortionOf({ distortion: -1 }), 0);
  assert.equal(distortionOf({ distortion: 'lots' }), 0);
  assert.ok(DEFAULT_STAGES.every(stage => distortionOf(stage) === 0));
});

test('distortion 0 turns every transform off', () => {
  for (let i = 0; i < 50; i++) {
    const d = randomDistortion(rng, { tilt: 12, distortion: 0 });
    assert.equal(d.rotate, 0);
    assert.equal(d.shear, 0);
    assert.equal(d.scaleX, 1);
    assert.equal(d.italic, false);
    assert.equal(d.warp, null);
  }
  // An undistorted "1" is a plain upright bar: stroke width plus the 1px crop margins.
  for (let i = 0; i < 50; i++) {
    assert.ok(makeVectorDigitMask('1', rng, { tilt: 12, distortion: 0 }).w <= 16);
  }
});

test('more distortion means more varied shapes', () => {
  const none = meanWidth('1', { tilt: 12, distortion: 0 });
  const half = meanWidth('1', { tilt: 12, distortion: 0.5 });
  const full = meanWidth('1', { tilt: 12, distortion: 1 });
  assert.ok(none < half && half < full, `${none} < ${half} < ${full}`);
});

test('blobs rasterize', () => {
  for (let i = 0; i < 20; i++) assert.ok(area(makeVectorBlobMask(rng)) > 100);
});

test('the scene runs without a DOM', () => {
  const scene = new Scene(FIELD.width, FIELD.height, vectorGlyphs);
  scene.reset({ ...DEFAULT_STAGES[0], decoys: 2 }, '1234', 100);
  for (let i = 1; i <= 10; i++) {
    scene.step(1 / 30, 100 + i / 30);
    scene.render(100 + i / 30);
  }
  assert.ok(scene.pixels.every(p => p === 0xffffffff || p === 0xff000000));
  assert.equal(new Set(scene.owner).size, 7); // background + 2 decoys + 4 digits
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../src/core/scene.js';
import { vectorGlyphs } from '../src/core/vector-glyphs.js';
import { DEFAULT_STAGES, FIELD } from '../src/config.js';

const mono = DEFAULT_STAGES[0];

function sceneWith(overrides) {
  const scene = new Scene(FIELD.width, FIELD.height, vectorGlyphs);
  scene.reset({ ...mono, ...overrides }, '4821', 0);
  return scene;
}

/** Share of pixels that differ between two renders of the same instant. */
function rerenderDifference(overrides) {
  const scene = sceneWith(overrides);
  scene.step(1 / 30, 1 / 30);
  scene.render(1 / 30);
  const first = scene.pixels.slice();
  scene.render(1 / 30);
  let changed = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== scene.pixels[i]) changed++;
  return changed / first.length;
}

test('without noise or jitter, a frame is fully determined by time', () => {
  assert.equal(rerenderDifference({}), 0);
});

test('noise replaces the requested share of pixels with one-frame random dots', () => {
  // Two independent renders differ wherever either one drew a random dot that
  // happened to disagree: 1 - (1-n)² - … ≈ 0.375 for n = 0.5 in black-and-white.
  const diff = rerenderDifference({ noise: 0.5 });
  assert.ok(diff > 0.32 && diff < 0.43, `difference ${diff}`);
});

test('jitter makes pixels show a neighbour instead of sliding rigidly', () => {
  const diff = rerenderDifference({ jitter: 0.5 });
  assert.ok(diff > 0.1 && diff < 0.45, `difference ${diff}`);
});

test('noise, jitter and short lives keep digits and background statistically alike', () => {
  for (const overrides of [
    {},
    { noise: 0.3, jitter: 0.3, life: [0.06, 0.12] },
    { noise: 0.5, jitter: 0.5 }
  ]) {
    const scene = sceneWith(overrides);
    const counts = { digit: [0, 0], background: [0, 0] }; // [changed, total]
    let previous = null;
    for (let f = 1; f <= 90; f++) {
      scene.step(1 / 30, f / 30);
      scene.render(f / 30);
      if (previous) {
        for (let i = 0; i < previous.length; i++) {
          const c = scene.owner[i] ? counts.digit : counts.background;
          c[1]++;
          if (scene.pixels[i] !== previous[i]) c[0]++;
        }
      }
      previous = scene.pixels.slice();
    }
    const digit = counts.digit[0] / counts.digit[1];
    const background = counts.background[0] / counts.background[1];
    assert.ok(
      Math.abs(digit - background) < 0.03,
      `${JSON.stringify(overrides)}: digit ${digit.toFixed(3)} vs background ${background.toFixed(3)}`
    );
  }
});

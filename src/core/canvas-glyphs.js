import { randomDistortion, warpAndCrop } from './mask.js';

/**
 * Browser glyphs: digits drawn with real system fonts on a canvas (random
 * font, weight and size, plus the stage's geometric distortion).
 */

const ALPHA_THRESHOLD = 110;

const DIGIT_FONTS = [
  '"Arial Black", "Helvetica Neue", Arial, sans-serif',
  'Verdana, "DejaVu Sans", sans-serif',
  '"Times New Roman", "DejaVu Serif", serif',
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'Impact, "Arial Narrow", sans-serif',
  '"Trebuchet MS", "Segoe UI", sans-serif',
  'system-ui, sans-serif'
];
const DIGIT_WEIGHTS = ['700', '800', '900'];

let scratch = null;

/** A cleared 2D context of the given size on a shared scratch canvas. */
function scratchContext(width, height) {
  scratch ??= document.createElement('canvas');
  // Assigning the size always clears the bitmap and resets the context state.
  scratch.width = width;
  scratch.height = height;
  return scratch.getContext('2d', { willReadFrequently: true });
}

/** Thresholds the canvas alpha channel into a cw×ch binary bitmap. */
function readBitmap(g, cw, ch) {
  const alpha = g.getImageData(0, 0, cw, ch).data;
  const full = new Uint8Array(cw * ch);
  for (let i = 0; i < full.length; i++) full[i] = alpha[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
  return full;
}

/**
 * "1" is drawn as one plain vertical stroke, like "l", "I" or "|": a flagged
 * "1" that has been tilted, sheared and warped is too easy to misread as "7".
 * Its height matches the digits of the current font.
 */
function drawOne(g, size, rng) {
  const m = g.measureText('0');
  const measured = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
  const height = measured > size * 0.4 ? measured : size * 0.72;
  const width = size * rng.range(0.19, 0.25);
  g.fillRect(-width / 2, -height / 2, width, height);
  g.strokeRect(-width / 2, -height / 2, width, height);
}

/**
 * Binary mask of one digit in a random font, weight and size, distorted per
 * `stage.tilt` and `stage.distortion` (see `randomDistortion`).
 */
export function makeDigitMask(digit, rng, stage) {
  const cw = 96,
    ch = 104;
  const g = scratchContext(cw, ch);

  const d = randomDistortion(rng, stage);
  const size = Math.round(rng.range(50, 60));
  const italic = d.italic ? 'italic ' : '';
  g.font = `${italic}${rng.pick(DIGIT_WEIGHTS)} ${size}px ${rng.pick(DIGIT_FONTS)}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineWidth = rng.range(2.5, 4.5); // thicker strokes keep enough dots inside each stroke
  g.translate(cw / 2, ch / 2);
  g.rotate(d.rotate);
  g.transform(d.scaleX, 0, d.shear, 1, 0, 0);

  if (digit === '1') {
    drawOne(g, size, rng);
  } else {
    g.fillText(digit, 0, 0);
    g.strokeText(digit, 0, 0);
  }

  const shape = warpAndCrop(readBitmap(g, cw, ch), cw, ch, d.warp);
  if (!shape) throw new Error(`Driftcha: could not rasterize digit "${digit}"`);
  return shape;
}

/** Irregular filled polygon used as a distractor; clearly not a digit. */
export function makeBlobMask(rng) {
  const cw = 48,
    ch = 48;
  const g = scratchContext(cw, ch);
  const corners = Math.round(rng.range(5, 8));
  const radius = rng.range(9, 14);

  g.fillStyle = '#fff';
  g.beginPath();
  for (let k = 0; k < corners; k++) {
    const a = (k / corners) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const r = radius * rng.range(0.65, 1.25);
    g.lineTo(cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();

  const shape = warpAndCrop(readBitmap(g, cw, ch), cw, ch, null);
  if (!shape) throw new Error('Driftcha: could not rasterize decoy');
  return shape;
}

/** Glyph provider for `Scene`. Needs a DOM (canvas + system fonts). */
export const canvasGlyphs = Object.freeze({ digit: makeDigitMask, blob: makeBlobMask });

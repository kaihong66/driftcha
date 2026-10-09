import { randomDistortion, warpAndCrop } from './mask.js';

/**
 * DOM-free glyphs: digits defined as stroke skeletons and rasterized as thick
 * round-capped polylines. Used by the server, which has no canvas or fonts.
 * Variety comes from per-digit variants, random height and stroke weight, and
 * the same geometric distortion as the canvas glyphs.
 */

const DEG = Math.PI / 180;

function arc(cx, cy, rx, ry, from, to, steps = 32) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (from + ((to - from) * i) / steps) * DEG;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function quad([x0, y0], [cx, cy], [x1, y1], steps = 16) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
  }
  return pts;
}

const line = (...pts) => pts;
const ring = (cx, cy, rx, ry) => arc(cx, cy, rx, ry, 0, 360, 40);

// Skeletons in unit space: y from -0.5 (top) to 0.5 (bottom), x roughly
// -0.3..0.3. Each digit lists one or more variants; a variant is a list of
// polylines. "1" is always a single vertical stroke so it never reads as "7".
const DIGITS = {
  0: [[ring(0, 0, 0.27, 0.48)]],
  1: [[line([0, -0.5], [0, 0.5])]],
  2: [
    [arc(0, -0.22, 0.26, 0.27, 195, 395), line([0.213, -0.065], [-0.27, 0.5], [0.28, 0.5])],
    [
      arc(0, -0.22, 0.26, 0.27, 195, 395),
      quad([0.213, -0.065], [-0.05, 0.22], [-0.27, 0.5]),
      line([-0.27, 0.5], [0.28, 0.5])
    ]
  ],
  3: [[arc(0, -0.25, 0.24, 0.25, 200, 450), arc(0, 0.24, 0.27, 0.26, 270, 520)]],
  4: [
    [line([0.12, 0.5], [0.12, -0.5], [-0.3, 0.18], [0.3, 0.18])],
    [line([-0.1, -0.5], [-0.28, 0.16], [0.3, 0.16]), line([0.14, -0.22], [0.14, 0.5])]
  ],
  5: [[line([0.26, -0.5], [-0.2, -0.5], [-0.24, -0.04]), arc(0, 0.2, 0.27, 0.3, 215, 510)]],
  6: [
    [quad([0.22, -0.47], [-0.3, -0.36], [-0.26, 0.2]), ring(0, 0.2, 0.26, 0.29)],
    [line([0.16, -0.5], [-0.24, 0.1]), ring(0, 0.2, 0.26, 0.29)]
  ],
  7: [[line([-0.28, -0.5], [0.28, -0.5], [-0.06, 0.5])]],
  8: [[ring(0, -0.25, 0.22, 0.24), ring(0, 0.23, 0.27, 0.27)]],
  9: [
    [ring(0, -0.2, 0.26, 0.29), quad([0.26, -0.2], [0.3, 0.32], [-0.18, 0.5])],
    [ring(0, -0.2, 0.26, 0.29), line([0.26, -0.2], [0.2, 0.5])]
  ]
};

/** Marks every pixel whose centre lies within `r` of segment a–b. */
function drawSegment(full, cw, ch, [ax, ay], [bx, by], r) {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
  const x1 = Math.min(cw - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
  const y1 = Math.min(ch - 1, Math.ceil(Math.max(ay, by) + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax,
        py = y + 0.5 - ay;
      let t = len2 ? (px * dx + py * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - t * dx,
        ey = py - t * dy;
      if (ex * ex + ey * ey <= r2) full[y * cw + x] = 1;
    }
  }
}

/**
 * Binary mask of one digit, same size range as the canvas glyphs, distorted
 * per `stage.tilt` and `stage.distortion` (see `randomDistortion`).
 */
export function makeVectorDigitMask(digit, rng, stage) {
  const variants = DIGITS[digit];
  if (!variants) throw new Error(`Driftcha: no vector glyph for "${digit}"`);
  const cw = 96,
    ch = 104;

  const d = randomDistortion(rng, stage);
  const height = rng.range(38, 46);
  const half = rng.range(4.2, 6.2); // stroke half-width (px)
  const width = height * d.scaleX;
  const shear = d.shear; // italics are a font feature; vector strokes skip them
  const cos = Math.cos(d.rotate),
    sin = Math.sin(d.rotate);
  const toPixel = ([u, v]) => {
    const x = u * width + shear * v * height,
      y = v * height;
    return [cw / 2 + x * cos - y * sin, ch / 2 + x * sin + y * cos];
  };

  const full = new Uint8Array(cw * ch);
  for (const stroke of rng.pick(variants)) {
    const pts = stroke.map(toPixel);
    for (let i = 1; i < pts.length; i++) drawSegment(full, cw, ch, pts[i - 1], pts[i], half);
  }

  const shape = warpAndCrop(full, cw, ch, d.warp);
  if (!shape) throw new Error(`Driftcha: could not rasterize digit "${digit}"`);
  return shape;
}

/** Irregular filled polygon used as a distractor (even-odd fill). */
export function makeVectorBlobMask(rng) {
  const cw = 48,
    ch = 48;
  const corners = Math.round(rng.range(5, 8));
  const radius = rng.range(9, 14);
  const pts = [];
  for (let k = 0; k < corners; k++) {
    const a = (k / corners) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const r = radius * rng.range(0.65, 1.25);
    pts.push([cw / 2 + Math.cos(a) * r, ch / 2 + Math.sin(a) * r]);
  }

  const full = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const py = y + 0.5;
    for (let x = 0; x < cw; x++) {
      const px = x + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i],
          [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) full[y * cw + x] = 1;
    }
  }

  const shape = warpAndCrop(full, cw, ch, null);
  if (!shape) throw new Error('Driftcha: could not rasterize decoy');
  return shape;
}

/** Glyph provider for `Scene`. Works anywhere, including Node.js. */
export const vectorGlyphs = Object.freeze({ digit: makeVectorDigitMask, blob: makeVectorBlobMask });

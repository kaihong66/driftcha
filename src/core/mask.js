/**
 * DOM-free helpers shared by the canvas (browser) and vector (server) glyph
 * rasterizers. A mask is `{ w, h, mask }` where `mask` is a w×h Uint8Array
 * with 1 for pixels inside the shape.
 */

const DEG = Math.PI / 180;

/** A stage's `distortion`, clamped to 0..1. Missing or invalid means 0 (off). */
export function distortionOf(stage) {
  const k = Number(stage?.distortion ?? 0);
  return Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
}

/**
 * Random geometric distortion for one digit: rotation (up to `stage.tilt`
 * degrees), horizontal squash, shear, italics and a sine warp.
 * `stage.distortion` (0–1) scales all of it: 0 (the default) gives upright,
 * unwarped shapes and 1 is full strength.
 *
 * It is off by default because it buys almost nothing: once the digits have
 * been separated from the motion, even full strength only trips weak OCR
 * engines, while strong OCR and vision-language models read it fine. It mostly
 * makes the digits harder for people.
 */
export function randomDistortion(rng, stage) {
  const k = distortionOf(stage);
  const tilt = stage?.tilt ?? 0;
  const scaled = v => v * k + 0; // `+ 0` turns -0 into 0
  const warp = randomWarp(rng);
  return {
    rotate: scaled(rng.range(-tilt, tilt) * DEG),
    scaleX: 1 + scaled(rng.range(0.82, 1.08) - 1),
    shear: scaled(rng.range(-0.18, 0.18)),
    italic: rng.next() < 0.2 * k,
    warp: k > 0 ? { ...warp, ax: warp.ax * k, ay: warp.ay * k } : null
  };
}

/** Random sine-warp parameters used to bend digit masks. */
export function randomWarp(rng) {
  return {
    ax: rng.range(1.0, 2.6),
    ay: rng.range(0.8, 2.2),
    fx: rng.range(0.12, 0.25),
    fy: rng.range(0.1, 0.22),
    px: rng.range(0, Math.PI * 2),
    py: rng.range(0, Math.PI * 2)
  };
}

/**
 * Samples a cw×ch binary bitmap through an optional sine warp, then crops it
 * to its bounding box plus a 1px margin so the mask centre is the shape centre.
 * @param {Uint8Array} full cw×ch bitmap, 1 = inside
 * @returns {{ w: number, h: number, mask: Uint8Array } | null} null if empty
 */
export function warpAndCrop(full, cw, ch, warp) {
  const src = full;
  const dst = warp ? new Uint8Array(cw * ch) : full;
  let minX = cw,
    minY = ch,
    maxX = -1,
    maxY = -1;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let sx = x,
        sy = y;
      if (warp) {
        sx = Math.round(x + warp.ax * Math.sin(y * warp.fy + warp.py));
        sy = Math.round(y + warp.ay * Math.sin(x * warp.fx + warp.px));
        if (sx < 0 || sy < 0 || sx >= cw || sy >= ch) continue;
      }
      if (!src[sy * cw + sx]) continue;
      if (warp) dst[y * cw + x] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const w = maxX - minX + 3,
    h = maxY - minY + 3;
  const mask = new Uint8Array(w * h);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (dst[y * cw + x]) mask[(y - minY + 1) * w + (x - minX + 1)] = 1;
    }
  }
  return { w, h, mask };
}

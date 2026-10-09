import { NoiseRng } from './random.js';
import { Plates } from './plates.js';
import { ShapeLayer } from './layer.js';

/**
 * The raw noise field. Every pixel is a short-lived dot that re-rolls its
 * colour when it expires. A single frame is uniform noise; the digits are
 * only visible because their dots move differently from the surroundings.
 *
 * DOM-free: it writes into `pixels` and gets digit shapes from an injected
 * glyph provider (`canvasGlyphs` in the browser, `vectorGlyphs` on a server).
 */
export class Scene {
  /**
   * @param {{ digit: Function, blob: Function }} glyphs
   */
  constructor(width, height, glyphs) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.glyphs = glyphs;
    this.rng = new NoiseRng();
    this.stage = null;
    this.epoch = 0; // internal times are relative to this, so they fit in Float32

    this.pixels = new Uint32Array(this.size); // 0xAABBGGRR
    this.owner = new Uint8Array(this.size); // 0 = background, otherwise layer id

    this.plates = new Plates(this);
    this.layers = [];
  }

  /** Builds a fresh field showing `code` with the parameters of `stage`. `t` is in seconds. */
  reset(stage, code, t) {
    const { width: W, height: H, rng, glyphs } = this;
    if (stage.decoys + code.length > 255) throw new RangeError('Driftcha: too many shapes');
    this.stage = stage;
    this.epoch = t;
    rng.reseed();
    this.plates.init(0);

    const layers = [];
    let id = 1;
    for (let k = 0; k < stage.decoys; k++) {
      const region = { x0: 14, x1: W - 14, y0: 14, y1: H - 14 };
      layers.push(new ShapeLayer(this, id++, glyphs.blob(rng), region, 0));
    }
    for (let i = 0; i < code.length; i++) {
      const shape = glyphs.digit(code[i], rng, stage);
      const halfH = 0.5 * shape.h + 2;
      const slotX = (W * (i + 0.5)) / code.length;
      let y0 = halfH + 2,
        y1 = H - halfH - 2;
      if (y0 > y1) y0 = y1 = H / 2;
      layers.push(new ShapeLayer(this, id++, shape, { x0: slotX - 8, x1: slotX + 8, y0, y1 }, 0));
    }
    this.layers = layers;
  }

  dotColor() {
    const r = this.rng.u32();
    if (this.stage.color) return 0xff000000 | (r & 0xffffff);
    return r & 1 ? 0xffffffff : 0xff000000;
  }

  newLife() {
    const [min, max] = this.stage.life;
    return min + this.rng.next() * (max - min);
  }

  /** Flow speed shared by plates and shapes. */
  randomSpeed() {
    const [min, max] = this.stage.speed;
    return this.rng.range(min, max);
  }

  /** When a plate or shape should next change direction. */
  nextTurnAt(t) {
    return t + this.rng.range(0.35, 0.9);
  }

  step(dt, t) {
    const rt = t - this.epoch;
    this.plates.update(dt, rt);
    for (const layer of this.layers) layer.update(dt, rt);
  }

  render(t) {
    const rt = t - this.epoch;
    this.owner.fill(0);
    for (const layer of this.layers) layer.rasterize();
    this.plates.draw(rt);
    for (const layer of this.layers) layer.draw(rt);
    this.perturb();
  }

  /**
   * Per-frame perturbations that weaken frame-to-frame matching. Both apply to
   * every pixel alike, digit or background, so per-pixel statistics stay uniform.
   *  - `jitter` (0–1): share of pixels that show a random 4-neighbour's dot this
   *    frame, so dots wobble by a pixel instead of sliding rigidly.
   *  - `noise` (0–1): share of pixels replaced by a fresh random dot that lives
   *    for this frame only and carries no motion.
   */
  perturb() {
    const jitter = clamp01(this.stage.jitter);
    const noise = clamp01(this.stage.noise);
    if (!jitter && !noise) return;

    const { width: W, height: H, pixels, rng } = this;
    const jitterBelow = Math.round(jitter * 0x10000); // compared with 16 random bits
    const noiseBelow = Math.round(noise * 0x4000); // compared with 14 other random bits
    if (jitter) {
      this.scratch ??= new Uint32Array(this.size);
      this.scratch.set(pixels);
    }
    const src = this.scratch;

    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const r = rng.u32();
        if (noiseBelow && r >>> 18 < noiseBelow) {
          pixels[i] = this.dotColor();
        } else if (jitterBelow && (r & 0xffff) < jitterBelow) {
          switch ((r >>> 16) & 3) {
            case 0:
              pixels[i] = src[x > 0 ? i - 1 : i];
              break;
            case 1:
              pixels[i] = src[x < W - 1 ? i + 1 : i];
              break;
            case 2:
              pixels[i] = src[y > 0 ? i - W : i];
              break;
            default:
              pixels[i] = src[y < H - 1 ? i + W : i];
          }
        }
      }
    }
  }
}

function clamp01(value) {
  const v = Number(value ?? 0);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

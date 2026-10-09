// "How it works" figures: one scene drawn three ways.
//   Fig. 1 a frozen frame, Fig. 2 the live noise, Fig. 3 the live noise tinted by
//   the direction each dot is drifting (taken from the engine's ground truth).
import { DEFAULT_STAGES, FIELD } from '../src/config.js';
import { Scene } from '../src/core/scene.js';
import { canvasGlyphs } from '../src/core/canvas-glyphs.js';
import { secureCode } from '../src/core/random.js';

const MAX_STEP = 0.05;
const BUCKETS = 72; // 5° hue steps

/** HSL (h in degrees, s and l in 0..1) as a little-endian 0xAABBGGRR pixel. */
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (0xff000000 | (f(4) << 16) | (f(8) << 8) | f(0)) >>> 0;
}

// Two shades per direction, [dark dot, light dot]: muted for the background
// patches, vivid for the digits so they read at a glance.
const PLATE_TINT = new Uint32Array(BUCKETS * 2);
const DIGIT_TINT = new Uint32Array(BUCKETS * 2);
for (let b = 0; b < BUCKETS; b++) {
  const hue = (b * 360) / BUCKETS;
  PLATE_TINT[b * 2] = hsl(hue, 0.18, 0.1);
  PLATE_TINT[b * 2 + 1] = hsl(hue, 0.28, 0.36);
  DIGIT_TINT[b * 2] = hsl(hue, 0.7, 0.28);
  DIGIT_TINT[b * 2 + 1] = hsl(hue, 0.95, 0.68);
}

const bucket = (vx, vy) => {
  const deg = ((Math.atan2(vy, vx) * 180) / Math.PI + 360) % 360;
  return Math.round(deg / (360 / BUCKETS)) % BUCKETS;
};

function surface(canvas) {
  canvas.width = FIELD.width;
  canvas.height = FIELD.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(FIELD.width, FIELD.height);
  return { ctx, image, px: new Uint32Array(image.data.buffer) };
}

function show(target, pixels) {
  target.px.set(pixels);
  target.ctx.putImageData(target.image, 0, 0);
}

export function mountExplainer(root, shuffleButton) {
  const still = surface(root.querySelector('[data-fig="still"]'));
  const live = surface(root.querySelector('[data-fig="live"]'));
  const flow = surface(root.querySelector('[data-fig="flow"]'));

  const scene = new Scene(FIELD.width, FIELD.height, canvasGlyphs);
  const tinted = new Uint32Array(scene.size);
  const plateTint = new Uint32Array(512);
  const layerTint = new Uint32Array(512);
  let snapshot = true;

  function shuffle() {
    scene.reset(DEFAULT_STAGES[0], secureCode(4), performance.now() / 1000);
    snapshot = true;
  }

  function tint() {
    const { plates, layers, owner, pixels } = scene;
    for (let k = 0; k < plates.count; k++) {
      const b = bucket(plates.vx[k], plates.vy[k]) * 2;
      plateTint[k * 2] = PLATE_TINT[b];
      plateTint[k * 2 + 1] = PLATE_TINT[b + 1];
    }
    for (const layer of layers) {
      const b = bucket(layer.vx, layer.vy) * 2;
      layerTint[layer.id * 2] = DIGIT_TINT[b];
      layerTint[layer.id * 2 + 1] = DIGIT_TINT[b + 1];
    }
    const map = plates.map;
    for (let i = 0; i < tinted.length; i++) {
      const lit = pixels[i] & 1;
      const id = owner[i];
      tinted[i] = id ? layerTint[id * 2 + lit] : plateTint[map[i] * 2 + lit];
    }
  }

  let raf = 0;
  let last = 0;
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min((ts - last) / 1000, MAX_STEP) : 0;
    last = ts;
    const t = ts / 1000;
    scene.step(dt, t);
    scene.render(t);
    show(live, scene.pixels);
    if (snapshot) {
      show(still, scene.pixels);
      snapshot = false;
    }
    tint();
    show(flow, tinted);
  }

  // Only animate while the figures are on screen.
  new IntersectionObserver(entries => {
    const visible = entries[entries.length - 1].isIntersecting;
    if (visible && !raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    } else if (!visible && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }).observe(root);

  shuffleButton?.addEventListener('click', shuffle);
  shuffle();
}

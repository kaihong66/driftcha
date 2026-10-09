import { NoiseRng } from './random.js';
import { ColorGrade } from './grade.js';

const MAX_STEP = 0.05; // s; don't leap forward after a stall or a background tab

/**
 * Owns the visible canvas and the animation loop. Each frame it asks the
 * current frame source for new raw pixels (a local simulation, or frames
 * streamed from a server), upscales them with nearest-neighbour sampling, and
 * applies the colour grade and a faint random tint.
 *
 * The loop pauses while the canvas is scrolled out of view, and the backing
 * store is refit to the element's device-pixel width so dots stay crisp.
 *
 * A frame source is `{ width, height, frame(t, dt) => Uint32Array | null, dispose() }`.
 */
export class Renderer {
  constructor(canvas) {
    this.view = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.rng = new NoiseRng();
    this.grade = new ColorGrade();
    // Older engines lack CanvasRenderingContext2D#filter; grade the element instead.
    this.cssFilter = typeof this.ctx.filter !== 'string';

    this.raw = document.createElement('canvas');
    this.rawCtx = this.raw.getContext('2d', { alpha: false });
    this.width = 0;
    this.height = 0;
    this.image = null;
    this.raw32 = null;
    this.scale = 0;

    this.source = null;
    this.color = false;
    this.running = false;
    this.visible = true;
    this.raf = 0;
    this.last = 0;
    this.lastT = 0;
    this.tick = this.tick.bind(this);

    if (typeof IntersectionObserver !== 'undefined') {
      this.visibility = new IntersectionObserver(entries => {
        this.visible = entries[entries.length - 1].isIntersecting;
        this.sync();
      });
      this.visibility.observe(canvas);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.fit());
      this.resize.observe(canvas);
    }
  }

  /** Switches to a new frame source; the previous one is disposed. */
  setSource(source, color) {
    if (this.source && this.source !== source) this.source.dispose();
    this.source = source;
    this.color = color;
    if (source.width !== this.width || source.height !== this.height)
      this.setField(source.width, source.height);
    this.grade.retarget(performance.now() / 1000, color, this.rng);
  }

  /** Disposes the current source but keeps its last frame on screen. */
  detach() {
    this.source?.dispose();
    this.source = null;
  }

  start() {
    this.running = true;
    this.sync();
  }

  stop() {
    this.running = false;
    this.sync();
  }

  destroy() {
    this.stop();
    this.detach();
    this.visibility?.disconnect();
    this.resize?.disconnect();
  }

  sync() {
    const active = this.running && this.visible;
    if (active && !this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.tick);
    } else if (!active && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  setField(width, height) {
    this.width = width;
    this.height = height;
    this.raw.width = width;
    this.raw.height = height;
    this.image = this.rawCtx.createImageData(width, height);
    this.raw32 = new Uint32Array(this.image.data.buffer); // little-endian: 0xAABBGGRR
    this.raw32.fill(0xff000000);
    this.rawCtx.putImageData(this.image, 0, 0);
    this.scale = 0;
    this.setScale(2);
    this.fit();
  }

  setScale(scale) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.view.width = this.width * scale;
    this.view.height = this.height * scale;
  }

  fit() {
    const cssWidth = this.view.clientWidth;
    if (!cssWidth || !this.width) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(8, Math.max(1, Math.round((cssWidth * dpr) / this.width)));
    if (scale === this.scale) return;
    this.setScale(scale);
    // Resizing clears the canvas; repaint the last frame if the loop is paused.
    if (!this.raf) this.paint(this.lastT, 0);
  }

  tick(ts) {
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.last ? Math.min((ts - this.last) / 1000, MAX_STEP) : 0;
    this.last = ts;
    const t = ts / 1000;
    this.lastT = t;

    const pixels = this.source?.frame(t, dt);
    if (pixels) {
      this.raw32.set(pixels);
      this.rawCtx.putImageData(this.image, 0, 0);
    }
    if (this.image) this.paint(t, dt);
  }

  paint(t, dt) {
    const { ctx, view, grade, rng, color } = this;

    grade.update(t, dt, color, rng);
    const filter = grade.filter(color);

    ctx.save();
    ctx.imageSmoothingEnabled = false; // keep dots sharp when upscaling
    if (this.cssFilter) view.style.filter = filter;
    else ctx.filter = filter;
    ctx.drawImage(this.raw, 0, 0, view.width, view.height);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    if (color) {
      ctx.globalAlpha = rng.range(0.018, 0.055);
      ctx.fillStyle = `rgb(${rng.u32() & 255},${rng.u32() & 255},${rng.u32() & 255})`;
    } else {
      const g = rng.u32() & 255;
      ctx.globalAlpha = rng.range(0.012, 0.04);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
    }
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.restore();
  }
}

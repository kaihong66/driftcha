const TAU = Math.PI * 2;
const TILE = 128; // side of a layer's toroidal dot texture
const DRIFT_SPEED = [5, 9]; // outline drift speed (px/s)
const SAMPLES = [
  [0, 0],
  [-0.35, -0.35],
  [0.35, -0.35],
  [-0.35, 0.35],
  [0.35, 0.35]
];
const scratchVelocity = { x: 0, y: 0 };

/**
 * A digit or decoy. It has two independent motions:
 *  - Outline: the shape itself drifts slowly inside its region and bounces off
 *    the edges. Keeping this slow keeps "covered/uncovered" edge events rare,
 *    so the shape area does not flicker more than the background.
 *  - Dot texture: anchored in screen space and flowing at the same speed as
 *    the background plates, only in a different direction. Because it is
 *    anchored to the screen, moving the outline never drags dots along.
 */
export class ShapeLayer {
  constructor(scene, id, shape, region, t) {
    const { rng } = scene;
    this.scene = scene;
    this.id = id;
    this.w = shape.w;
    this.h = shape.h;
    this.mask = shape.mask;
    this.region = region;

    this.cx = rng.range(region.x0, region.x1);
    this.cy = rng.range(region.y0, region.y1);
    this.dvx = 0;
    this.dvy = 0;
    this.driftUntil = 0;

    this.ax = rng.range(0, TILE);
    this.ay = rng.range(0, TILE);
    this.vx = 0;
    this.vy = 0;
    this.turnAt = 0;
    this.col = new Uint32Array(TILE * TILE);
    this.exp = new Float32Array(TILE * TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      this.col[i] = scene.dotColor();
      this.exp[i] = t + rng.next() * scene.newLife();
    }

    // Screen-space bounds from the last rasterize() pass, reused by draw().
    this.ox = 0;
    this.oy = 0;
    this.x0 = 0;
    this.x1 = -1;
    this.y0 = 0;
    this.y1 = -1;

    this.pickVelocity(t);
    this.pickDrift(t);
  }

  /** Smallest speed of (vx, vy) relative to the plates under five sample points of the shape. */
  minRelativeSpeed(vx, vy) {
    let min = Infinity;
    for (const [fx, fy] of SAMPLES) {
      this.scene.plates.velocityAt(this.cx + fx * this.w, this.cy + fy * this.h, scratchVelocity);
      const r = Math.hypot(vx - scratchVelocity.x, vy - scratchVelocity.y);
      if (r < min) min = r;
    }
    return min;
  }

  /**
   * Random speed (same distribution as the background); the direction is the
   * best of 12 random tries at standing out from every plate underneath.
   * Plate directions are uniformly random, so the result is still isotropic.
   * (A pixel's change rate depends on |vx| + |vy|; an axis-biased direction
   * would make the digits measurably "calmer" than the background.)
   */
  pickVelocity(t) {
    const { rng } = this.scene;
    const speed = this.scene.randomSpeed();
    let best = -1;
    for (let k = 0; k < 12; k++) {
      const a = rng.range(0, TAU);
      const vx = Math.cos(a) * speed,
        vy = Math.sin(a) * speed;
      const rel = this.minRelativeSpeed(vx, vy);
      if (rel > best) {
        best = rel;
        this.vx = vx;
        this.vy = vy;
      }
    }
    this.turnAt = this.scene.nextTurnAt(t);
  }

  pickDrift(t) {
    const { rng } = this.scene;
    const a = rng.range(0, TAU),
      speed = rng.range(DRIFT_SPEED[0], DRIFT_SPEED[1]);
    this.dvx = Math.cos(a) * speed;
    this.dvy = Math.sin(a) * speed;
    this.driftUntil = t + rng.range(1.0, 2.2);
  }

  update(dt, t) {
    // Turn on schedule, or right away when the plates underneath start moving
    // almost the same way (the shape would briefly vanish).
    if (t >= this.turnAt || this.minRelativeSpeed(this.vx, this.vy) < this.scene.stage.speed[0] * 0.6) {
      this.pickVelocity(t);
    }
    this.ax = (this.ax + this.vx * dt + TILE) % TILE;
    this.ay = (this.ay + this.vy * dt + TILE) % TILE;

    if (t >= this.driftUntil) this.pickDrift(t);
    const r = this.region;
    this.cx += this.dvx * dt;
    if (r.x1 - r.x0 < 1e-3) this.cx = r.x0;
    else if (this.cx < r.x0) {
      this.cx = Math.min(r.x1, 2 * r.x0 - this.cx);
      this.dvx = -this.dvx;
    } else if (this.cx > r.x1) {
      this.cx = Math.max(r.x0, 2 * r.x1 - this.cx);
      this.dvx = -this.dvx;
    }
    this.cy += this.dvy * dt;
    if (r.y1 - r.y0 < 1e-3) this.cy = r.y0;
    else if (this.cy < r.y0) {
      this.cy = Math.min(r.y1, 2 * r.y0 - this.cy);
      this.dvy = -this.dvy;
    } else if (this.cy > r.y1) {
      this.cy = Math.max(r.y0, 2 * r.y1 - this.cy);
      this.dvy = -this.dvy;
    }
  }

  /** Claims this frame's pixels in `scene.owner` (later layers win). */
  rasterize() {
    const { width: W, height: H, owner } = this.scene;
    const ox = this.cx - this.w / 2,
      oy = this.cy - this.h / 2;
    this.ox = ox;
    this.oy = oy;
    this.x0 = Math.max(0, Math.floor(ox));
    this.x1 = Math.min(W - 1, Math.ceil(ox + this.w));
    this.y0 = Math.max(0, Math.floor(oy));
    this.y1 = Math.min(H - 1, Math.ceil(oy + this.h));

    for (let py = this.y0; py <= this.y1; py++) {
      const ly = Math.floor(py + 0.5 - oy);
      if (ly < 0 || ly >= this.h) continue;
      const row = ly * this.w;
      for (let px = this.x0; px <= this.x1; px++) {
        const lx = Math.floor(px + 0.5 - ox);
        if (lx < 0 || lx >= this.w) continue;
        if (this.mask[row + lx]) owner[py * W + px] = this.id;
      }
    }
  }

  draw(t) {
    const scene = this.scene;
    const { width: W, owner, pixels } = scene;
    const { col, exp, id } = this;
    const fax = Math.floor(this.ax),
      fay = Math.floor(this.ay);

    for (let py = this.y0; py <= this.y1; py++) {
      let ty = (py - fay) % TILE;
      if (ty < 0) ty += TILE;
      const trow = ty * TILE;
      for (let px = this.x0; px <= this.x1; px++) {
        const idx = py * W + px;
        if (owner[idx] !== id) continue;
        let tx = (px - fax) % TILE;
        if (tx < 0) tx += TILE;
        const ti = trow + tx;
        if (t >= exp[ti]) {
          col[ti] = scene.dotColor();
          exp[ti] = t + scene.newLife();
        }
        pixels[idx] = col[ti];
      }
    }
  }
}

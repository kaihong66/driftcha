const TAU = Math.PI * 2;

/**
 * Background: the field is split into irregular plates (weighted, wavy Voronoi
 * cells). Each plate owns an independent field-sized toroidal dot texture that
 * slides rigidly in its own random direction, while the plate borders stay put.
 * With no dominant flow direction, "align and stack frames" only ever lines up
 * one small plate at a time.
 */
export class Plates {
  constructor(scene) {
    this.scene = scene;
    this.map = new Uint8Array(scene.size); // pixel -> plate index
    this.count = 0;
    this.tex = new Uint32Array(0); // count × size dot colours
    this.exp = new Float32Array(0); // count × size dot expiry times (s, scene-relative)
  }

  init(t) {
    const scene = this.scene;
    const { width: W, height: H, size: N, rng } = scene;
    const K = scene.stage.plates;
    if (!(K >= 1 && K <= 256)) throw new RangeError(`Driftcha: plates must be 1-256, got ${K}`);
    this.count = K;

    // Weighted Voronoi plus a wave term so borders are curved, not a grid.
    // The wave factors into per-column and per-row tables: K·(W+H) trig calls
    // instead of 2·K·W·H.
    const sx = new Float64Array(K),
      sy = new Float64Array(K),
      sw = new Float64Array(K);
    const waveX = new Float64Array(K * W),
      waveY = new Float64Array(K * H);
    for (let k = 0; k < K; k++) {
      sx[k] = rng.range(0, W);
      sy[k] = rng.range(0, H);
      sw[k] = rng.range(0.8, 1.25);
      const amp = rng.range(3, 8);
      const fx = rng.range(0.04, 0.12),
        fy = rng.range(0.04, 0.12);
      const px = rng.range(0, TAU),
        py = rng.range(0, TAU);
      for (let x = 0; x < W; x++) waveX[k * W + x] = amp * Math.sin(x * fx + px);
      for (let y = 0; y < H; y++) waveY[k * H + y] = Math.cos(y * fy + py);
    }
    const map = this.map;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let best = 0,
          bestD = Infinity;
        for (let k = 0; k < K; k++) {
          const dx = x + 0.5 - sx[k],
            dy = y + 0.5 - sy[k];
          const d = Math.sqrt(dx * dx + dy * dy) * sw[k] + waveX[k * W + x] * waveY[k * H + y];
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        map[y * W + x] = best;
      }
    }

    this.ox = new Float64Array(K);
    this.oy = new Float64Array(K);
    this.vx = new Float64Array(K);
    this.vy = new Float64Array(K);
    this.turnAt = new Float64Array(K);
    this.offX = new Int32Array(K);
    this.offY = new Int32Array(K);
    for (let k = 0; k < K; k++) {
      this.ox[k] = rng.range(0, W);
      this.oy[k] = rng.range(0, H);
      this.pickVelocity(k, t);
    }

    const total = K * N;
    if (this.tex.length < total) {
      this.tex = new Uint32Array(total);
      this.exp = new Float32Array(total);
    }
    for (let i = 0; i < total; i++) {
      this.tex[i] = scene.dotColor();
      this.exp[i] = t + rng.next() * scene.newLife(); // staggered so dots don't renew in sync
    }
  }

  pickVelocity(k, t) {
    const scene = this.scene;
    const a = scene.rng.range(0, TAU),
      speed = scene.randomSpeed();
    this.vx[k] = Math.cos(a) * speed;
    this.vy[k] = Math.sin(a) * speed;
    this.turnAt[k] = scene.nextTurnAt(t);
  }

  update(dt, t) {
    const { width: W, height: H } = this.scene;
    for (let k = 0; k < this.count; k++) {
      if (t >= this.turnAt[k]) this.pickVelocity(k, t);
      this.ox[k] = (this.ox[k] + this.vx[k] * dt + W) % W;
      this.oy[k] = (this.oy[k] + this.vy[k] * dt + H) % H;
    }
  }

  /** Writes the velocity of the plate under (x, y) into `out`. */
  velocityAt(x, y, out) {
    const { width: W, height: H } = this.scene;
    const px = Math.min(W - 1, Math.max(0, x | 0));
    const py = Math.min(H - 1, Math.max(0, y | 0));
    const k = this.map[py * W + px];
    out.x = this.vx[k];
    out.y = this.vy[k];
    return out;
  }

  /**
   * Paints every pixel not owned by a shape layer. Dot lifetimes are stored as
   * expiry times and only checked when a dot is actually drawn, so hidden dots
   * cost nothing.
   */
  draw(t) {
    const scene = this.scene;
    const { width: W, height: H, size: N, owner, pixels } = scene;
    const { map, tex, exp, offX, offY, count: K } = this;

    for (let k = 0; k < K; k++) {
      offX[k] = Math.floor(this.ox[k]) % W;
      offY[k] = Math.floor(this.oy[k]) % H;
    }
    for (let y = 0, idx = 0; y < H; y++) {
      for (let x = 0; x < W; x++, idx++) {
        if (owner[idx] !== 0) continue; // covered by a digit or decoy
        const k = map[idx];
        let tx = x - offX[k];
        if (tx < 0) tx += W;
        let ty = y - offY[k];
        if (ty < 0) ty += H;
        const ti = k * N + ty * W + tx;
        if (t >= exp[ti]) {
          tex[ti] = scene.dotColor();
          exp[ti] = t + scene.newLife();
        }
        pixels[idx] = tex[ti];
      }
    }
  }
}

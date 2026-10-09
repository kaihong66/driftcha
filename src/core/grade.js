const RATE = 0.055; // share of the remaining distance covered per 60 Hz frame

/**
 * Display-level colour grading that keeps drifting toward random targets.
 * It is applied while upscaling the raw field, so the shown pixels never map
 * 1:1 onto the dot colours.
 */
export class ColorGrade {
  constructor() {
    this.value = { contrast: 1.05, brightness: 1, saturate: 1, hue: 0 };
    this.target = { ...this.value };
    this.changeAt = 0;
  }

  retarget(t, color, rng) {
    this.target = color
      ? {
          contrast: rng.range(0.8, 1.6),
          brightness: rng.range(0.8, 1.18),
          saturate: rng.range(0.75, 1.95),
          hue: rng.range(-180, 180)
        }
      : {
          contrast: rng.range(0.85, 1.55),
          brightness: rng.range(0.82, 1.18),
          saturate: 0,
          hue: 0
        };
    this.changeAt = t + rng.range(0.16, 0.52);
  }

  update(t, dt, color, rng) {
    if (t >= this.changeAt) this.retarget(t, color, rng);
    const k = 1 - Math.pow(1 - RATE, dt * 60); // frame-rate independent easing
    const v = this.value,
      g = this.target;
    v.contrast += (g.contrast - v.contrast) * k;
    v.brightness += (g.brightness - v.brightness) * k;
    v.saturate += (g.saturate - v.saturate) * k;
    let dh = g.hue - v.hue;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    v.hue += dh * k;
    if (v.hue > 180) v.hue -= 360;
    else if (v.hue < -180) v.hue += 360;
  }

  /** CSS filter string for the current grade. */
  filter(color) {
    const v = this.value;
    const base = `contrast(${v.contrast.toFixed(2)}) brightness(${v.brightness.toFixed(2)})`;
    return color
      ? `${base} saturate(${v.saturate.toFixed(2)}) hue-rotate(${v.hue.toFixed(1)}deg)`
      : `grayscale(1) ${base}`;
  }
}

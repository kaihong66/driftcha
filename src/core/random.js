/**
 * Two independent random sources:
 *  - `secureInt` / `secureHex` / `secureCode` (Web Crypto) pick the answer and challenge id.
 *  - `NoiseRng` (sfc32, seeded from Web Crypto) drives the animation.
 * Even if someone recovers the animation PRNG state from rendered frames,
 * it reveals nothing about the answer.
 */

/** Uniform integer in [0, n) without modulo bias. */
export function secureInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

/** `bytes` random bytes as lowercase hex. */
export function secureHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/** Random numeric code of `length` digits; the first digit is never 0. */
export function secureCode(length) {
  let code = String(1 + secureInt(9));
  while (code.length < length) code += String(secureInt(10));
  return code;
}

/** sfc32 generator used for everything visual. Fast, not cryptographic. */
export class NoiseRng {
  constructor() {
    this.a = 0;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.reseed();
  }

  reseed() {
    const seed = new Uint32Array(4);
    crypto.getRandomValues(seed);
    this.a = seed[0] | 0;
    this.b = seed[1] | 0;
    this.c = seed[2] | 0;
    this.d = seed[3] | 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Next 32-bit unsigned integer. */
  u32() {
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next() {
    return this.u32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
}

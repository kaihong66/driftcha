/**
 * Raw noise field size. The field is upscaled for display (`scale` is the
 * starting factor; the renderer refits it to the element and device pixel ratio).
 * All motion values below are in raw field pixels.
 */
export const FIELD = Object.freeze({ width: 260, height: 120, scale: 2 });

/**
 * Challenge stages, played in order.
 *
 * Digits, decoys and background plates all share `speed` and `life`, so no
 * per-pixel statistic (change rate, dot lifetime, colour) separates them —
 * only the direction of motion does.
 */
export const DEFAULT_STAGES = Object.freeze([
  Object.freeze({
    id: 'mono',
    label: 'Mono',
    description: 'black-and-white',
    color: false,
    life: [0.22, 0.55], // dot lifetime range (s)
    speed: [24, 40], // dot texture flow speed range (px/s)
    tilt: 8, // max digit rotation (deg) at full distortion
    // Geometric distortion strength, 0 (upright, unwarped) to 1 (rotation up to
    // `tilt`, squash, shear, italics, wave warp). Off by default: in testing even
    // full strength only tripped weak OCR engines (and simple post-processing
    // undoes that), while strong OCR and vision-language models read it fine.
    // It mostly made the digits harder for people.
    distortion: 0,
    noise: 0, // share of pixels replaced by one-frame random dots each frame (0–1)
    jitter: 0, // share of pixels showing a neighbour's dot each frame (0–1)
    plates: 10, // background plates (1–256)
    decoys: 0 // non-digit distractor shapes
  }),
  Object.freeze({
    id: 'color',
    label: 'Color',
    description: 'color',
    color: true,
    life: [0.16, 0.42],
    speed: [24, 40],
    tilt: 12,
    distortion: 0,
    noise: 0,
    jitter: 0,
    plates: 12,
    decoys: 0
  })
]);

/**
 * Proof-of-work run before every protected button action.
 * Each action needs `count` nonces whose SHA-256(prefix + nonce) starts with
 * `bits` zero bits (~262k hashes at the defaults; well under a second). Every wrong
 * answer in the last `penaltyWindow` ms adds `bitsPerWrong` bits and every reload
 * `bitsPerReload` (each bit doubles the work), up to `maxPenaltyBits` in total.
 * The mock server counts penalties per client IP, so a new session doesn't reset them.
 */
export const POW = Object.freeze({
  bits: 16,
  count: 4,
  bitsPerWrong: 2,
  bitsPerReload: 1,
  maxPenaltyBits: 8,
  penaltyWindow: 60_000
});

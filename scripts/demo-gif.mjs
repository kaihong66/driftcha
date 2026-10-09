#!/usr/bin/env node
/**
 * Renders an animated GIF of the noise field (for the README) using the same
 * DOM-free engine as the mock server. No browser or dependencies needed.
 *
 *   npm run demo:gif -- --code 7149 --stage mono --seconds 3 --scale 2 --out docs/demo.gif
 *   (add --distortion 0..1 to override the stage's distortion)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_STAGES, FIELD } from '../src/config.js';
import { Scene } from '../src/core/scene.js';
import { vectorGlyphs } from '../src/core/vector-glyphs.js';
import { secureCode } from '../src/core/random.js';

const { values: args } = parseArgs({
  options: {
    stage: { type: 'string', default: 'mono' },
    seconds: { type: 'string', default: '3' },
    scale: { type: 'string', default: '2' },
    fps: { type: 'string', default: '25' },
    code: { type: 'string' },
    distortion: { type: 'string' },
    out: { type: 'string', default: 'docs/demo.gif' }
  }
});

const base = DEFAULT_STAGES.find(s => s.id === args.stage);
if (!base)
  throw new Error(`Unknown stage "${args.stage}" (use ${DEFAULT_STAGES.map(s => s.id).join(' or ')})`);
const stage = args.distortion === undefined ? base : { ...base, distortion: Number(args.distortion) };
const code = args.code ?? secureCode(4);
if (!/^\d+$/.test(code)) throw new Error('--code must be digits');
const scale = Math.max(1, Math.round(Number(args.scale)));
const fps = Number(args.fps);
const delay = Math.round(100 / fps); // GIF delays are in 1/100 s
const frames = Math.round(Number(args.seconds) * fps);

// ---------------------------------------------------------------- palette

function palette(color) {
  if (!color) return { size: 2, rgb: [0, 0, 0, 255, 255, 255], index: p => p & 1 };
  // RGB332, the same quantization the server stream uses.
  const rgb = [];
  for (let v = 0; v < 256; v++) {
    rgb.push(Math.round((((v >> 5) & 7) * 255) / 7), Math.round((((v >> 2) & 7) * 255) / 7), (v & 3) * 85);
  }
  return { size: 256, rgb, index: p => (p & 0xe0) | ((p >>> 11) & 0x1c) | ((p >>> 22) & 0x03) };
}

// ---------------------------------------------------------------- GIF encoding

const stamp = new Int32Array(1 << 20); // generation stamps for the LZW table
const table = new Int16Array(1 << 20); // (prefix << 8 | symbol) -> code
let generation = 0;

/** GIF-flavoured LZW (variable code size, clear at 4096 codes). */
function lzw(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize,
    eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const out = [];
  let acc = 0,
    bits = 0;
  const emit = c => {
    acc |= c << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  };

  generation++;
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    if (stamp[key] === generation) {
      prefix = table[key];
      continue;
    }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      generation++;
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      stamp[key] = generation;
      table[key] = nextCode++;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (bits > 0) out.push(acc & 0xff);
  return out;
}

const u16 = n => [n & 0xff, (n >> 8) & 0xff];

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

// ---------------------------------------------------------------- render

const pal = palette(stage.color);
const W = FIELD.width * scale,
  H = FIELD.height * scale;
const tableBits = Math.log2(pal.size);
const minCodeSize = Math.max(2, tableBits);

const parts = [
  Buffer.from('GIF89a', 'ascii'),
  Buffer.from([...u16(W), ...u16(H), 0x80 | (7 << 4) | (tableBits - 1), 0, 0]),
  Buffer.from(pal.rgb),
  // Loop forever.
  Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0, 0, 0])
];

const scene = new Scene(FIELD.width, FIELD.height, vectorGlyphs);
scene.reset(stage, code, 0);
const indices = new Uint8Array(W * H);

for (let f = 1; f <= frames; f++) {
  const t = f / fps;
  scene.step(1 / fps, t);
  scene.render(t);
  const px = scene.pixels;
  for (let y = 0; y < H; y++) {
    const src = ((y / scale) | 0) * FIELD.width;
    for (let x = 0; x < W; x++) indices[y * W + x] = pal.index(px[src + ((x / scale) | 0)]);
  }
  parts.push(
    Buffer.from([0x21, 0xf9, 0x04, 0x04, ...u16(delay), 0, 0]), // graphic control: no disposal
    Buffer.from([0x2c, 0, 0, 0, 0, ...u16(W), ...u16(H), 0]), // image descriptor
    Buffer.from([minCodeSize, ...subBlocks(lzw(indices, minCodeSize))])
  );
}
parts.push(Buffer.from([0x3b]));

const gif = Buffer.concat(parts);
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, gif);
console.log(
  `${args.out}: ${W}×${H}, ${frames} frames @ ${fps} fps, ${(gif.length / 1024).toFixed(0)} KB, code ${code}`
);

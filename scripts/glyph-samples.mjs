#!/usr/bin/env node
/**
 * Writes clean four-digit images (black digits on white, laid out like a
 * challenge) plus an answer key. Use them to check how well OCR engines and
 * vision-language models read the shapes once an attacker has already
 * separated them from the motion (the attacker's best case), at the stage's
 * distortion level or any other.
 *
 *   npm run glyph-samples -- --distortion 0.5 --count 20 --out glyph-samples
 *
 * Uses the server's vector digits. Browser-only mode draws digits with system
 * fonts instead, so its shapes differ.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_STAGES, FIELD } from '../src/config.js';
import { makeVectorDigitMask } from '../src/core/vector-glyphs.js';
import { NoiseRng, secureCode } from '../src/core/random.js';
import { encodeGrayPng, upscale } from './lib/png.mjs';

const { values: args } = parseArgs({
  options: {
    distortion: { type: 'string' }, // default: the stage's own setting
    stage: { type: 'string', default: 'mono' },
    count: { type: 'string', default: '20' },
    scale: { type: 'string', default: '2' },
    out: { type: 'string', default: 'glyph-samples' }
  }
});

const base = DEFAULT_STAGES.find(s => s.id === args.stage);
if (!base)
  throw new Error(`Unknown stage "${args.stage}" (use ${DEFAULT_STAGES.map(s => s.id).join(' or ')})`);
const distortion = Number(args.distortion ?? base.distortion ?? 0);
if (!(distortion >= 0 && distortion <= 1)) throw new Error('--distortion must be between 0 and 1');
const stage = { ...base, distortion };
const count = Math.max(1, Math.round(Number(args.count)));
const scale = Math.max(1, Math.round(Number(args.scale)));

// ---------------------------------------------------------------- render

const rng = new NoiseRng();
const W = FIELD.width,
  H = FIELD.height;

/** Lays out `code` like the scene does: one slot per digit, random drift inside it. */
function render(code) {
  const img = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < code.length; i++) {
    const m = makeVectorDigitMask(code[i], rng, stage);
    const halfH = 0.5 * m.h + 2;
    const cx = (W * (i + 0.5)) / code.length + rng.range(-8, 8);
    const cy = halfH + 2 <= H - halfH - 2 ? rng.range(halfH + 2, H - halfH - 2) : H / 2;
    const ox = Math.round(cx - m.w / 2),
      oy = Math.round(cy - m.h / 2);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const px = ox + x,
          py = oy + y;
        if (m.mask[y * m.w + x] && px >= 0 && py >= 0 && px < W && py < H) img[py * W + px] = 0;
      }
    }
  }
  return upscale(img, W, H, 1, scale);
}

mkdirSync(args.out, { recursive: true });
const answers = [];
const digits = String(count).length;
for (let n = 1; n <= count; n++) {
  const code = secureCode(4);
  const name = `sample-${String(n).padStart(digits, '0')}.png`;
  writeFileSync(join(args.out, name), encodeGrayPng(render(code), W * scale, H * scale));
  answers.push(`${name}\t${code}`);
}
writeFileSync(
  join(args.out, 'answers.txt'),
  `# stage=${stage.id} distortion=${distortion} tilt=${stage.tilt}\n${answers.join('\n')}\n`
);
console.log(`${count} samples at distortion ${distortion} in ${args.out}/ (answer key: answers.txt)`);

// Minimal PNG encoder (8-bit grayscale or RGB, no dependencies) for the scripts.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encode(pixels, width, height, channels) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height); // each row: filter byte 0, then pixels
  for (let y = 0; y < height; y++)
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = channels === 3 ? 2 : 0; // RGB or grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** @param {Uint8Array} gray width×height bytes */
export const encodeGrayPng = (gray, width, height) => encode(gray, width, height, 1);

/** @param {Uint8Array} rgb width×height×3 bytes */
export const encodeRgbPng = (rgb, width, height) => encode(rgb, width, height, 3);

/** Nearest-neighbour upscale of a width×height image with `channels` bytes per pixel. */
export function upscale(pixels, width, height, channels, scale) {
  if (scale === 1) return pixels;
  const out = new Uint8Array(width * scale * height * scale * channels);
  for (let y = 0; y < height * scale; y++) {
    const srcRow = ((y / scale) | 0) * width;
    for (let x = 0; x < width * scale; x++) {
      const src = (srcRow + ((x / scale) | 0)) * channels;
      const dst = (y * width * scale + x) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = pixels[src + c];
    }
  }
  return out;
}

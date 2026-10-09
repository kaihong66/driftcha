/**
 * Wire format for frames streamed by the server:
 *
 *   frame   := u32 little-endian payload length, payload
 *   payload := u8 format, pixel data
 *
 *   FORMAT_MONO   (0): 1 bit per pixel, row-major, least significant bit first; 1 = white
 *   FORMAT_RGB332 (1): 1 byte per pixel, rrrgggbb
 *
 * A 260×120 field is 3.9 kB per mono frame and 31 kB per colour frame.
 */

export const FORMAT_MONO = 0;
export const FORMAT_RGB332 = 1;

const HEADER = 5;
const MAX_PAYLOAD = 1 << 22;

/** Encodes a frame of 0xAABBGGRR pixels (as produced by `Scene`). */
export function encodeFrame(pixels, color) {
  const n = pixels.length;
  const size = color ? n : (n + 7) >> 3;
  const out = new Uint8Array(HEADER + size);
  const payload = size + 1;
  out[0] = payload & 0xff;
  out[1] = (payload >>> 8) & 0xff;
  out[2] = (payload >>> 16) & 0xff;
  out[3] = (payload >>> 24) & 0xff;
  out[4] = color ? FORMAT_RGB332 : FORMAT_MONO;

  if (color) {
    for (let i = 0; i < n; i++) {
      const p = pixels[i];
      out[HEADER + i] = (p & 0xe0) | ((p >>> 11) & 0x1c) | ((p >>> 22) & 0x03);
    }
  } else {
    for (let i = 0; i < n; i++) {
      if (pixels[i] & 1) out[HEADER + (i >> 3)] |= 1 << (i & 7);
    }
  }
  return out;
}

const RGB332 = new Uint32Array(256);
for (let v = 0; v < 256; v++) {
  const r = Math.round((((v >> 5) & 7) * 255) / 7);
  const g = Math.round((((v >> 2) & 7) * 255) / 7);
  const b = (v & 3) * 85;
  RGB332[v] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function decodeInto(buf, start, size, out) {
  const format = buf[start];
  const data = start + 1;
  const n = out.length;
  if (format === FORMAT_MONO) {
    if (size - 1 < (n + 7) >> 3) throw new Error('Driftcha: truncated mono frame');
    for (let i = 0; i < n; i++) out[i] = (buf[data + (i >> 3)] >> (i & 7)) & 1 ? 0xffffffff : 0xff000000;
  } else if (format === FORMAT_RGB332) {
    if (size - 1 < n) throw new Error('Driftcha: truncated colour frame');
    for (let i = 0; i < n; i++) out[i] = RGB332[buf[data + i]];
  } else {
    throw new Error(`Driftcha: unknown frame format ${format}`);
  }
}

/** Decodes one frame payload (format byte + pixel data, without the length prefix) into `out`. */
export function decodeFrame(payload, out) {
  decodeInto(payload, 0, payload.length, out);
}

/** Incremental decoder for a byte stream of frames. */
export class FrameDecoder {
  constructor() {
    this.buf = new Uint8Array(0);
    this.len = 0;
  }

  /**
   * Appends a chunk and decodes the newest complete frame into `out`
   * (older complete frames are skipped).
   * @returns {boolean} whether a frame was decoded
   */
  push(chunk, out) {
    if (this.len + chunk.length > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + chunk.length, 1 << 16));
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;

    const buf = this.buf;
    let offset = 0,
      latest = -1,
      latestSize = 0;
    while (this.len - offset >= 4) {
      const size =
        (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
      if (size < 1 || size > MAX_PAYLOAD) throw new Error('Driftcha: corrupt frame stream');
      if (this.len - offset - 4 < size) break;
      latest = offset + 4;
      latestSize = size;
      offset += 4 + size;
    }

    if (latest >= 0) decodeInto(buf, latest, latestSize, out);
    if (offset > 0) {
      buf.copyWithin(0, offset, this.len);
      this.len -= offset;
    }
    return latest >= 0;
  }
}

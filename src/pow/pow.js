import { createSha256 } from './sha256.js';

/*
 * Proof of work: find `count` distinct nonces such that SHA-256(prefix + nonce)
 * starts with `bits` zero bits. The search runs in a Web Worker so the noise
 * animation keeps running smoothly; if workers are unavailable (old engine,
 * strict CSP) it falls back to time-sliced work on the main thread.
 *
 * This module has no DOM dependencies at import time, so `checkPow` can also
 * verify proofs on a Node.js server.
 */

const sha256 = createSha256();

/**
 * Hashes `prefix + nonce` for increasing nonces until `found` holds `need`
 * solutions or `budgetMs` has passed. Returns the next nonce to try.
 * Must stay self-contained: its source is injected into the worker.
 */
function searchNonces(hash, prefix, shift, nonce, need, found, budgetMs) {
  const t0 = performance.now();
  do {
    for (let i = 0; i < 1024 && found.length < need; i++, nonce++) {
      if (hash(prefix + nonce)[0] >>> shift === 0) found.push(nonce);
    }
  } while (found.length < need && performance.now() - t0 < budgetMs);
  return nonce;
}

const WORKER_SOURCE = `"use strict";
const hash = (${createSha256})();
const searchNonces = ${searchNonces};
self.onmessage = (event) => {
  const { id, prefix, bits, count } = event.data;
  const shift = 32 - bits;
  const expected = count * Math.pow(2, bits);
  const found = [];
  let nonce = 0;
  while (found.length < count) {
    nonce = searchNonces(hash, prefix, shift, nonce, count, found, 16);
    self.postMessage({ id, progress: Math.max(found.length / count, Math.min(0.96, nonce / expected)) });
  }
  self.postMessage({ id, nonces: found });
};`;

let worker; // undefined: not tried yet; null: unavailable
let nextJobId = 0;
const jobs = new Map(); // id -> { prefix, bits, count, onProgress, resolve, reject }

function getWorker() {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !globalThis.URL?.createObjectURL) {
    return worker;
  }
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      if (!job) return;
      if (data.nonces) {
        jobs.delete(data.id);
        job.resolve(data.nonces);
      } else {
        job.onProgress(data.progress);
      }
    };
    w.onerror = event => {
      // Blocked or crashed: use the main thread from now on, including for queued jobs.
      event.preventDefault();
      w.terminate();
      worker = null;
      for (const [id, job] of jobs) {
        jobs.delete(id);
        solveOnMainThread(job.prefix, job.bits, job.count, job.onProgress).then(job.resolve, job.reject);
      }
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

let channel = null;
const waiting = [];

/** Yields to the event loop. MessageChannel avoids setTimeout's 4 ms clamping. */
function yieldToBrowser() {
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
  }
  return new Promise(resolve => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}

async function solveOnMainThread(prefix, bits, count, onProgress) {
  const shift = 32 - bits;
  const expected = count * Math.pow(2, bits);
  const found = [];
  let nonce = 0;
  await yieldToBrowser(); // let the busy state paint first
  while (found.length < count) {
    nonce = searchNonces(sha256, prefix, shift, nonce, count, found, 12);
    onProgress(Math.max(found.length / count, Math.min(0.96, nonce / expected)));
    if (found.length < count) await yieldToBrowser();
  }
  return found;
}

function assertParams(bits, count) {
  if (!Number.isInteger(bits) || bits < 1 || bits > 31)
    throw new RangeError('Driftcha: PoW bits must be 1-31');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Driftcha: PoW count must be >= 1');
}

/**
 * Finds `count` nonces for `prefix` at difficulty `bits`.
 * @param {(progress: number) => void} [onProgress] called with 0..1 estimates
 * @returns {Promise<number[]>}
 */
export function solvePow(prefix, bits, count, onProgress = () => {}) {
  assertParams(bits, count);
  const w = getWorker();
  if (!w) return solveOnMainThread(prefix, bits, count, onProgress);
  return new Promise((resolve, reject) => {
    const id = ++nextJobId;
    jobs.set(id, { prefix, bits, count, onProgress, resolve, reject });
    w.postMessage({ id, prefix, bits, count });
  });
}

/** Blocking variant of `solvePow` for tests and tooling. */
export function solvePowSync(prefix, bits, count) {
  assertParams(bits, count);
  const found = [];
  let nonce = 0;
  while (found.length < count) nonce = searchNonces(sha256, prefix, 32 - bits, nonce, count, found, Infinity);
  return found;
}

/** Checks a proof: exactly `count` distinct non-negative integer nonces, each a solution. */
export function checkPow(prefix, bits, count, nonces) {
  assertParams(bits, count);
  if (!Array.isArray(nonces) || nonces.length !== count || new Set(nonces).size !== count) return false;
  const shift = 32 - bits;
  return nonces.every(n => Number.isSafeInteger(n) && n >= 0 && sha256(prefix + n)[0] >>> shift === 0);
}

import { DEFAULT_STAGES, FIELD, POW } from '../config.js';
import { Scene } from '../core/scene.js';
import { canvasGlyphs } from '../core/canvas-glyphs.js';
import { secureCode, secureHex } from '../core/random.js';
import { checkPow } from '../pow/pow.js';

/*
 * Backend contract (shared with createServerBackend):
 *
 *   start(): Promise<Challenge>              new session at the first stage
 *   powParams(action): { prefix, bits, count } | null
 *   act('verify', { answer, nonces }) | act('reload', { nonces }): Promise<Outcome>
 *   dispose()
 *
 *   Challenge: { id, stageIndex, stages: [{ id, label, description, color }], length, source }
 *   Outcome:   { result: 'wrong' | 'next' | 'solved' | 'reloaded' | 'expired' | 'rejected' | 'early',
 *                challenge?: Challenge, token?: string | null }
 *
 *   'early' (server only): the answer came in before the minimum solve time and was
 *   not checked; the challenge stays live.
 */

/** Frame source that simulates the noise field in the page. */
class LocalSource {
  constructor(scene) {
    this.scene = scene;
    this.width = scene.width;
    this.height = scene.height;
    this.ready = true;
    this.disposed = false;
  }

  frame(t, dt) {
    if (this.disposed) return null;
    this.scene.step(dt, t);
    this.scene.render(t);
    return this.scene.pixels;
  }

  dispose() {
    this.disposed = true;
  }
}

/**
 * Everything runs in the browser: handy for static hosting, but the answer
 * lives in page memory. Use `createServerBackend` to keep it on a server.
 */
export function createLocalBackend({ stages = DEFAULT_STAGES, length = 4, pow = {} } = {}) {
  if (!stages.length) throw new Error('Driftcha: at least one stage is required');
  const powConfig = { ...POW, ...pow };
  const stageInfo = stages.map(({ id, label, description, color }) => ({ id, label, description, color }));

  let scene = null;
  let stageIndex = 0;
  let code = '';
  let challengeId = '';
  let pending = null; // proof-of-work parameters handed out for the next action
  let penalties = []; // recent wrong answers / reloads: { at, bits }

  function bits() {
    const now = performance.now();
    penalties = penalties.filter(p => now - p.at < powConfig.penaltyWindow);
    const extra = penalties.reduce((sum, p) => sum + p.bits, 0);
    return Math.min(31, powConfig.bits + Math.min(powConfig.maxPenaltyBits, extra));
  }

  function issue(index) {
    stageIndex = index;
    code = secureCode(length);
    challengeId = secureHex(8);
    pending = null;
    scene ??= new Scene(FIELD.width, FIELD.height, canvasGlyphs);
    scene.reset(stages[index], code, performance.now() / 1000);
    return { id: challengeId, stageIndex: index, stages: stageInfo, length, source: new LocalSource(scene) };
  }

  return {
    kind: 'local',

    async start() {
      penalties = [];
      return issue(0);
    },

    powParams(action) {
      if (!challengeId) return null;
      const b = bits();
      pending = { action, bits: b, prefix: `${challengeId}:${action}:${b}:${Date.now().toString(36)}:` };
      return { prefix: pending.prefix, bits: b, count: powConfig.count };
    },

    async act(action, { answer, nonces }) {
      const proof = pending;
      pending = null;
      if (!proof || proof.action !== action || !checkPow(proof.prefix, proof.bits, powConfig.count, nonces)) {
        return { result: 'rejected' };
      }
      if (action === 'reload') {
        penalties.push({ at: performance.now(), bits: powConfig.bitsPerReload });
        return { result: 'reloaded', challenge: issue(stageIndex) };
      }
      if (answer !== code) {
        penalties.push({ at: performance.now(), bits: powConfig.bitsPerWrong });
        return { result: 'wrong', challenge: issue(stageIndex) };
      }
      if (stageIndex < stages.length - 1) return { result: 'next', challenge: issue(stageIndex + 1) };
      code = '';
      challengeId = '';
      return { result: 'solved', token: null };
    },

    dispose() {}
  };
}

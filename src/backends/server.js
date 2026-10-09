import { FrameDecoder } from '../core/codec.js';

/**
 * Frame source fed by the server's binary frame stream (see core/codec.js).
 * Calls `onReady` after the first frame, `onEnd` if the server closes the
 * stream, and `onError` on network failure. Nothing fires after dispose().
 */
class RemoteSource {
  constructor(url, field) {
    this.width = field.width;
    this.height = field.height;
    this.pixels = new Uint32Array(field.width * field.height);
    this.fresh = false;
    this.ready = false;
    this.disposed = false;
    this.onReady = null;
    this.onEnd = null;
    this.onError = null;
    this.controller = new AbortController();
    this.read(url);
  }

  async read(url) {
    const decoder = new FrameDecoder();
    try {
      const res = await fetch(url, { signal: this.controller.signal, cache: 'no-store' });
      if (res.status === 410) return this.end();
      if (!res.ok || !res.body) throw new Error(`Frame stream failed (HTTP ${res.status})`);
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return this.end();
        if (this.disposed) return;
        if (decoder.push(value, this.pixels)) {
          this.fresh = true;
          if (!this.ready) {
            this.ready = true;
            this.onReady?.();
          }
        }
      }
    } catch (err) {
      if (!this.disposed) this.onError?.(err);
    }
  }

  end() {
    if (!this.disposed) this.onEnd?.();
  }

  frame() {
    if (!this.fresh) return null;
    this.fresh = false;
    return this.pixels;
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
  }
}

/**
 * Talks to a Driftcha server (see server/api.js). The server picks the code,
 * renders the noise and streams frames; the answer never reaches the page.
 * @param {{ endpoint?: string }} [options] API base URL, default '/api'
 */
export function createServerBackend({ endpoint = '/api' } = {}) {
  const base = endpoint.replace(/\/+$/, '');
  let session = '';
  let stages = [];
  let current = null;

  async function call(path, body) {
    const res = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const err = new Error(data?.error || `Server responded with HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function adopt(challenge) {
    current = challenge;
    const query = new URLSearchParams({ session, challenge: challenge.id });
    return {
      id: challenge.id,
      stageIndex: challenge.stage,
      stages,
      length: challenge.length,
      source: new RemoteSource(`${base}/stream?${query}`, challenge.field)
    };
  }

  return {
    kind: 'server',

    async start() {
      const data = await call('session', session ? { replace: session } : {});
      session = data.session;
      stages = data.stages;
      return adopt(data.challenge);
    },

    powParams(action) {
      const pow = current?.pow;
      return pow?.[action] ? { prefix: pow[action], bits: pow.bits, count: pow.count } : null;
    },

    async act(action, payload) {
      const data = await call(action, { session, challenge: current?.id, ...payload });
      if (data.pow && current) current.pow = data.pow; // proofs are single-use; fresh prefixes
      return {
        result: data.result,
        challenge: data.challenge ? adopt(data.challenge) : null,
        token: data.token ?? null
      };
    },

    dispose() {}
  };
}

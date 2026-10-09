import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_STAGES, FIELD, POW } from '../src/config.js';
import { Scene } from '../src/core/scene.js';
import { vectorGlyphs } from '../src/core/vector-glyphs.js';
import { secureCode, secureHex } from '../src/core/random.js';
import { encodeFrame } from '../src/core/codec.js';
import { checkPow } from '../src/pow/pow.js';

/**
 * Driftcha mock server: a zero-dependency reference implementation of the
 * server side. It picks the codes, renders the noise and streams the frames,
 * hands out single-use proof-of-work prefixes, checks answers and proofs, and
 * issues signed pass tokens that a site backend can verify.
 *
 * All state lives in memory, so it is a mock: fine for development and demos,
 * not for production traffic (no persistence, no clustering, simple limits).
 *
 * Endpoints (all JSON unless noted):
 *   GET  /api/health                                   -> { ok: true }
 *   POST /api/session    { replace? }                  -> { session, stages, challenge }
 *   GET  /api/stream?session=&challenge=               -> binary frame stream
 *   POST /api/verify     { session, challenge, answer, nonces }
 *   POST /api/reload     { session, challenge, nonces }
 *        -> { result: 'wrong' | 'next' | 'solved' | 'reloaded' | 'expired' | 'rejected' | 'early',
 *             challenge?, pow?, token? }
 *   POST /api/siteverify { token }                     -> { success, challengeId?, issuedAt?, error? }
 *
 * Session, verify and reload requests are rate limited per client IP (HTTP 429
 * with Retry-After), and an answer sent less than `minSolveTime` after the
 * challenge's first frame is refused unread with `result: 'early'`.
 *
 * `middleware(req, res, next)` works with node:http, Connect, Express and Vite.
 */

const DEFAULTS = {
  stages: DEFAULT_STAGES,
  length: 4,
  fps: 30,
  challengeTtl: 5 * 60_000,
  sessionTtl: 15 * 60_000,
  tokenTtl: 2 * 60_000,
  maxSessions: 1000,
  maxSessionsPerIp: 30,
  maxStreams: 64,
  // Answers sent sooner than this (ms) after the challenge's first streamed frame are
  // refused unread. People take about 8 s; it mainly slows bots down. 0 turns it off.
  minSolveTime: 4000,
  // Sliding-window limits per client IP: verify + reload requests, and new sessions.
  rateLimit: { window: 60_000, attempts: 20, sessions: 10 },
  // Who the limits and PoW penalties apply to. Behind a reverse proxy, read the
  // proxy's client-address header here, or every visitor shares one IP.
  clientIp: req => req.socket?.remoteAddress ?? 'unknown',
  secret: undefined, // HMAC key for pass tokens; random per process when unset
  onChallenge: undefined, // ({ session, id, stage, code }) => void. Tests/inspection only.
  // ({ challenge, index, owner }) => void, after each streamed frame. `owner` maps
  // every pixel to 0 (background) or a shape layer id and is reused, so copy it.
  // Tests/inspection only: it reveals where the digits are.
  onFrame: undefined
};

const RETIRE_GRACE = 2000; // ms a replaced challenge keeps streaming while the client switches

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function tooMany(res, waitMs) {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  send(
    res,
    429,
    { error: `Too many attempts. Try again in ${seconds} s.` },
    { 'Retry-After': String(seconds) }
  );
}

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'request body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' ? value : {});
      } catch {
        reject(httpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createApi(options = {}) {
  const cfg = {
    ...DEFAULTS,
    ...options,
    pow: { ...POW, ...options.pow },
    rateLimit: { ...DEFAULTS.rateLimit, ...options.rateLimit }
  };
  const secret = cfg.secret ? Buffer.from(String(cfg.secret)) : randomBytes(32);
  const stageInfo = cfg.stages.map(({ id, label, description, color }) => ({
    id,
    label,
    description,
    color
  }));
  const sessions = new Map(); // id -> { id, ip, stage, challenge, touched }
  const clients = new Map(); // ip -> { attempts, sessions, penalties }
  const usedTokens = new Map(); // token id -> expiry
  let streams = 0;

  const sweeper = setInterval(sweep, 30_000);
  sweeper.unref?.();

  // ---------------------------------------------------------------- clients

  function client(ip) {
    let c = clients.get(ip);
    if (!c) clients.set(ip, (c = { attempts: [], sessions: [], penalties: [] }));
    return c;
  }

  /** Sliding-window limiter: records a hit and returns 0, or the ms until a slot frees up. */
  function hit(log, limit, now = Date.now()) {
    const { window } = cfg.rateLimit;
    while (log.length && now - log[0] >= window) log.shift();
    if (!Number.isFinite(limit)) return 0;
    if (log.length >= limit) return log[0] + window - now;
    log.push(now);
    return 0;
  }

  function penalize(ip, bits) {
    client(ip).penalties.push({ at: Date.now(), bits });
  }

  /** Penalties are per IP: a fresh session must not reset the difficulty. */
  function powBits(ip) {
    const c = client(ip);
    const now = Date.now();
    c.penalties = c.penalties.filter(p => now - p.at < cfg.pow.penaltyWindow);
    const extra = c.penalties.reduce((sum, p) => sum + p.bits, 0);
    return Math.min(31, cfg.pow.bits + Math.min(cfg.pow.maxPenaltyBits, extra));
  }

  // ---------------------------------------------------------------- challenges

  /** Fresh single-use proof-of-work prefixes for the session's current challenge. */
  function issuePow(session) {
    const ch = session.challenge;
    const bits = powBits(session.ip);
    const expires = ch.expires.toString(36);
    const prefix = action => `${ch.id}:${action}:${bits}:${expires}:${secureHex(6)}:`;
    ch.pow = { bits, count: cfg.pow.count, verify: prefix('verify'), reload: prefix('reload') };
    return ch.pow;
  }

  function newChallenge(session, stage) {
    retire(session.challenge);
    const ch = {
      id: secureHex(8),
      stage,
      code: secureCode(cfg.length),
      expires: Date.now() + cfg.challengeTtl,
      retiredAt: 0,
      shownAt: 0, // when the first frame was streamed
      pow: null,
      stream: null
    };
    session.stage = stage;
    session.challenge = ch;
    issuePow(session);
    cfg.onChallenge?.({ session: session.id, id: ch.id, stage, code: ch.code });
    return ch;
  }

  function retire(ch) {
    if (ch && !ch.retiredAt) ch.retiredAt = Date.now();
  }

  /** What the client may see: never the code. */
  function publicChallenge(ch) {
    return {
      id: ch.id,
      stage: ch.stage,
      length: cfg.length,
      field: { width: FIELD.width, height: FIELD.height },
      fps: cfg.fps,
      pow: ch.pow
    };
  }

  // ---------------------------------------------------------------- tokens

  function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function readToken(token) {
    const [body, sig] = String(token ?? '').split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', secret).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- handlers

  async function createSession(req, res) {
    const ip = cfg.clientIp(req);
    const wait = hit(client(ip).sessions, cfg.rateLimit.sessions);
    if (wait) return tooMany(res, wait);
    const body = await readJson(req);

    const previous = sessions.get(String(body.replace ?? ''));
    if (previous && previous.ip === ip) dropSession(previous);

    let perIp = 0;
    for (const s of sessions.values()) if (s.ip === ip) perIp++;
    if (perIp >= cfg.maxSessionsPerIp)
      return send(res, 429, { error: 'Too many sessions. Try again later.' });
    if (sessions.size >= cfg.maxSessions) return send(res, 503, { error: 'Server busy. Try again later.' });

    const session = { id: secureHex(16), ip, stage: 0, challenge: null, touched: Date.now() };
    sessions.set(session.id, session);
    const ch = newChallenge(session, 0);
    send(res, 200, { session: session.id, stages: stageInfo, challenge: publicChallenge(ch) });
  }

  async function act(action, req, res) {
    const wait = hit(client(cfg.clientIp(req)).attempts, cfg.rateLimit.attempts);
    if (wait) return tooMany(res, wait);
    const body = await readJson(req);
    const session = sessions.get(String(body.session ?? ''));
    if (!session) return send(res, 404, { error: 'Session expired. Start again.' });
    session.touched = Date.now();

    const ch = session.challenge;
    if (!ch || ch.id !== body.challenge || Date.now() > ch.expires) {
      return send(res, 200, {
        result: 'expired',
        challenge: publicChallenge(newChallenge(session, session.stage))
      });
    }

    if (!checkPow(ch.pow[action], ch.pow.bits, ch.pow.count, body.nonces)) {
      // Each prefix is single-use: hand out new ones for the next attempt.
      return send(res, 200, { result: 'rejected', pow: issuePow(session) });
    }

    if (action === 'reload') {
      penalize(session.ip, cfg.pow.bitsPerReload);
      return send(res, 200, {
        result: 'reloaded',
        challenge: publicChallenge(newChallenge(session, session.stage))
      });
    }

    // Too soon after the first frame (or no frame streamed at all): refuse without
    // reading the answer, so the challenge stays live and nothing is learned.
    if (cfg.minSolveTime > 0 && (!ch.shownAt || Date.now() - ch.shownAt < cfg.minSolveTime)) {
      return send(res, 200, { result: 'early', pow: issuePow(session) });
    }

    if (String(body.answer ?? '') !== ch.code) {
      penalize(session.ip, cfg.pow.bitsPerWrong);
      return send(res, 200, {
        result: 'wrong',
        challenge: publicChallenge(newChallenge(session, session.stage))
      });
    }

    if (session.stage < cfg.stages.length - 1) {
      return send(res, 200, {
        result: 'next',
        challenge: publicChallenge(newChallenge(session, session.stage + 1))
      });
    }

    retire(ch);
    sessions.delete(session.id);
    const now = Date.now();
    const token = signToken({
      jti: secureHex(8),
      sid: session.id,
      cid: ch.id,
      iat: now,
      exp: now + cfg.tokenTtl
    });
    send(res, 200, { result: 'solved', token });
  }

  async function siteVerify(req, res) {
    const body = await readJson(req);
    const data = readToken(body.token);
    if (!data) return send(res, 200, { success: false, error: 'invalid-token' });
    if (Date.now() > data.exp) return send(res, 200, { success: false, error: 'expired-token' });
    if (usedTokens.has(data.jti)) return send(res, 200, { success: false, error: 'already-used' });
    usedTokens.set(data.jti, data.exp);
    send(res, 200, { success: true, challengeId: data.cid, issuedAt: new Date(data.iat).toISOString() });
  }

  function stream(req, res, url) {
    const session = sessions.get(url.searchParams.get('session') ?? '');
    const ch = session?.challenge;
    if (!ch || ch.retiredAt || ch.id !== url.searchParams.get('challenge') || Date.now() > ch.expires) {
      return send(res, 410, { error: 'challenge expired' });
    }
    ch.stream?.stop(); // one viewer per challenge
    if (streams >= cfg.maxStreams) return send(res, 503, { error: 'Server busy. Try again later.' });

    const stage = cfg.stages[ch.stage];
    const scene = new Scene(FIELD.width, FIELD.height, vectorGlyphs);
    let last = performance.now() / 1000;
    scene.reset(stage, ch.code, last);

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no'
    });
    streams++;

    let open = true;
    let blocked = false;
    let sent = 0;
    const stop = () => {
      if (!open) return;
      open = false;
      clearInterval(timer);
      streams--;
      if (ch.stream === handle) ch.stream = null;
      res.end();
    };
    const handle = { stop };
    ch.stream = handle;

    const timer = setInterval(() => {
      const now = Date.now();
      if (now > ch.expires || (ch.retiredAt && now - ch.retiredAt > RETIRE_GRACE)) return stop();
      const t = performance.now() / 1000;
      scene.step(Math.min(t - last, 0.1), t);
      last = t;
      if (blocked) return; // slow client: keep time moving, drop frames
      scene.render(t);
      ch.shownAt ||= now;
      const flushed = res.write(encodeFrame(scene.pixels, stage.color));
      cfg.onFrame?.({ challenge: ch.id, index: sent++, owner: scene.owner });
      if (!flushed) {
        blocked = true;
        res.once('drain', () => {
          blocked = false;
        });
      }
    }, 1000 / cfg.fps);

    req.on('close', stop);
    res.on('close', stop);
  }

  // ---------------------------------------------------------------- housekeeping

  function dropSession(session) {
    session.challenge?.stream?.stop();
    sessions.delete(session.id);
  }

  function sweep() {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (now - session.touched > cfg.sessionTtl) dropSession(session);
    }
    const idle = Math.max(cfg.rateLimit.window, cfg.pow.penaltyWindow);
    for (const [ip, c] of clients) {
      const last = Math.max(c.attempts.at(-1) ?? 0, c.sessions.at(-1) ?? 0, c.penalties.at(-1)?.at ?? 0);
      if (now - last >= idle) clients.delete(ip);
    }
    for (const [id, exp] of usedTokens) if (now > exp) usedTokens.delete(id);
  }

  async function middleware(req, res, next) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return next ? next() : send(res, 400, { error: 'bad request' });
    }
    const match = /\/api\/([a-z]+)$/.exec(url.pathname);
    if (!match) return next ? next() : send(res, 404, { error: 'not found' });

    const route = match[1];
    try {
      if (req.method === 'GET' && route === 'health') return send(res, 200, { ok: true, mode: 'mock' });
      if (req.method === 'GET' && route === 'stream') return stream(req, res, url);
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      switch (route) {
        case 'session':
          return await createSession(req, res);
        case 'verify':
          return await act('verify', req, res);
        case 'reload':
          return await act('reload', req, res);
        case 'siteverify':
          return await siteVerify(req, res);
        default:
          return send(res, 404, { error: 'not found' });
      }
    } catch (err) {
      if (res.headersSent) return res.end();
      send(res, err.status ?? 500, { error: err.expose ? err.message : 'internal error' });
      if (!err.expose) console.error('[driftcha]', err);
    }
  }

  function close() {
    clearInterval(sweeper);
    for (const session of [...sessions.values()]) dropSession(session);
    clients.clear();
    usedTokens.clear();
  }

  return { middleware, close };
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi } from '../server/api.js';
import { solvePowSync } from '../src/pow/pow.js';
import { FrameDecoder } from '../src/core/codec.js';

const answers = new Map();
const servers = [];
let base;

/** Starts a mock server on a free port and returns its API base URL. */
async function serve(options) {
  const api = createApi({ pow: { bits: 6 }, onChallenge: c => answers.set(c.id, c.code), ...options });
  const server = http.createServer((req, res) => api.middleware(req, res, () => res.writeHead(404).end()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push({ api, server });
  return `http://127.0.0.1:${server.address().port}/api`;
}

before(async () => {
  // The flow tests below don't wait out the minimum solve time or count requests;
  // the speed bumps have their own servers further down.
  base = await serve({ minSolveTime: 0, rateLimit: { attempts: Infinity, sessions: Infinity } });
});

after(() => {
  for (const { api, server } of servers) {
    api.close();
    server.closeAllConnections();
    server.close();
  }
});

async function post(path, body, { at = base, headers = {} } = {}) {
  const res = await fetch(`${at}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, headers: res.headers, data: await res.json() };
}

const prove = (challenge, action) =>
  solvePowSync(challenge.pow[action], challenge.pow.bits, challenge.pow.count);
const wrongAnswer = code => (code[0] === '1' ? '2' : '1') + code.slice(1);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readOneFrame(session, challenge, at = base) {
  const res = await fetch(`${at}/stream?session=${session}&challenge=${challenge.id}`);
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new FrameDecoder();
  const out = new Uint32Array(challenge.field.width * challenge.field.height);
  for (;;) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    if (decoder.push(value, out)) break;
  }
  await reader.cancel();
  return out;
}

test('health check', async () => {
  const res = await fetch(`${base}/health`);
  assert.deepEqual(await res.json(), { ok: true, mode: 'mock' });
});

test('a full session: stream, reject, wrong, reload, two stages, token', async () => {
  const { data: start } = await post('session', {});
  const { session } = start;
  assert.equal(start.stages.length, 2);
  let ch = start.challenge;
  assert.equal(ch.stage, 0);
  assert.equal('code' in ch, false);

  // Stage 1 streams black-and-white frames.
  const frame = await readOneFrame(session, ch);
  assert.ok(frame.every(p => p === 0xffffffff || p === 0xff000000));

  // A bogus proof is rejected and the prefixes are replaced.
  let r = await post('verify', { session, challenge: ch.id, answer: '0000', nonces: [1, 2, 3, 4] });
  assert.equal(r.data.result, 'rejected');
  assert.notEqual(r.data.pow.verify, ch.pow.verify);
  ch.pow = r.data.pow;

  // A wrong answer burns the challenge and raises the difficulty.
  r = await post('verify', {
    session,
    challenge: ch.id,
    answer: wrongAnswer(answers.get(ch.id)),
    nonces: prove(ch, 'verify')
  });
  assert.equal(r.data.result, 'wrong');
  assert.notEqual(r.data.challenge.id, ch.id);
  assert.equal(r.data.challenge.pow.bits, ch.pow.bits + 2);

  // The old challenge is gone, even with its right answer.
  r = await post('verify', {
    session,
    challenge: ch.id,
    answer: answers.get(ch.id),
    nonces: prove(ch, 'verify')
  });
  assert.equal(r.data.result, 'expired');
  ch = r.data.challenge;

  // Reload.
  r = await post('reload', { session, challenge: ch.id, nonces: prove(ch, 'reload') });
  assert.equal(r.data.result, 'reloaded');
  ch = r.data.challenge;
  assert.equal(ch.stage, 0);

  // Correct answer: on to the colour stage.
  r = await post('verify', {
    session,
    challenge: ch.id,
    answer: answers.get(ch.id),
    nonces: prove(ch, 'verify')
  });
  assert.equal(r.data.result, 'next');
  ch = r.data.challenge;
  assert.equal(ch.stage, 1);
  await readOneFrame(session, ch);

  // Correct again: solved, with a pass token.
  r = await post('verify', {
    session,
    challenge: ch.id,
    answer: answers.get(ch.id),
    nonces: prove(ch, 'verify')
  });
  assert.equal(r.data.result, 'solved');
  const { token } = r.data;
  assert.equal(typeof token, 'string');

  // The token verifies exactly once, and tampering breaks it.
  r = await post('siteverify', { token });
  assert.equal(r.data.success, true);
  assert.equal(r.data.challengeId, ch.id);
  r = await post('siteverify', { token });
  assert.deepEqual(r.data, { success: false, error: 'already-used' });
  r = await post('siteverify', { token: `${token.slice(0, -2)}xx` });
  assert.deepEqual(r.data, { success: false, error: 'invalid-token' });

  // The session is closed after success.
  r = await post('verify', { session, challenge: ch.id, answer: '1234', nonces: [] });
  assert.equal(r.status, 404);
});

test('stale streams and bad input are refused', async () => {
  const res = await fetch(`${base}/stream?session=nope&challenge=nope`);
  assert.equal(res.status, 410);
  await res.body?.cancel();

  const bad = await fetch(`${base}/verify`, { method: 'POST', body: '{not json' });
  assert.equal(bad.status, 400);

  const get = await fetch(`${base}/verify`);
  assert.equal(get.status, 405);
});

test('replacing a session frees its slot', async () => {
  const first = await post('session', {});
  const second = await post('session', { replace: first.data.session });
  assert.equal(second.status, 200);
  const r = await post('reload', {
    session: first.data.session,
    challenge: first.data.challenge.id,
    nonces: []
  });
  assert.equal(r.status, 404);
});

test('answers before the minimum solve time are refused unread', async () => {
  const at = await serve({ minSolveTime: 400 });
  const { data: start } = await post('session', {}, { at });
  const { session } = start;
  let ch = start.challenge;
  const answer = answers.get(ch.id);

  // Nothing streamed yet: too early, however right the answer.
  let r = await post('verify', { session, challenge: ch.id, answer, nonces: prove(ch, 'verify') }, { at });
  assert.equal(r.data.result, 'early');
  assert.equal('challenge' in r.data, false);
  assert.equal(r.data.pow.bits, ch.pow.bits); // no penalty
  ch.pow = r.data.pow;

  // Streamed, but answered straight away: still too early.
  await readOneFrame(session, ch, at);
  const shown = Date.now();
  r = await post('verify', { session, challenge: ch.id, answer, nonces: prove(ch, 'verify') }, { at });
  assert.equal(r.data.result, 'early');
  ch.pow = r.data.pow;

  // The challenge was never burned: after the wait the same answer passes.
  await sleep(400 - (Date.now() - shown) + 20);
  r = await post('verify', { session, challenge: ch.id, answer, nonces: prove(ch, 'verify') }, { at });
  assert.equal(r.data.result, 'next');

  // Reloading is never held back.
  ch = r.data.challenge;
  r = await post('reload', { session, challenge: ch.id, nonces: prove(ch, 'reload') }, { at });
  assert.equal(r.data.result, 'reloaded');
});

test('sessions and attempts are rate limited per IP', async () => {
  const at = await serve({
    rateLimit: { window: 60_000, attempts: 3, sessions: 2 },
    clientIp: req => req.headers['x-test-ip'] ?? 'a'
  });

  const first = await post('session', {}, { at });
  assert.equal(first.status, 200);
  assert.equal((await post('session', {}, { at })).status, 200);
  const limited = await post('session', {}, { at });
  assert.equal(limited.status, 429);
  assert.match(limited.data.error, /Try again in \d+ s/);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  // Another IP has its own budget.
  assert.equal((await post('session', {}, { at, headers: { 'x-test-ip': 'b' } })).status, 200);

  // Every verify / reload request counts, even one with a bogus proof.
  const { session, challenge } = first.data;
  for (let i = 0; i < 3; i++) {
    const r = await post('reload', { session, challenge: challenge.id, nonces: [] }, { at });
    assert.equal(r.status, 200);
  }
  const r = await post('verify', { session, challenge: challenge.id, answer: '0000', nonces: [] }, { at });
  assert.equal(r.status, 429);
});

test('wrong answers raise the proof of work faster, per IP', async () => {
  const at = await serve({
    minSolveTime: 0,
    pow: { bits: 4, bitsPerWrong: 2, bitsPerReload: 1, maxPenaltyBits: 5 },
    clientIp: req => req.headers['x-test-ip'] ?? 'a'
  });
  const { data: start } = await post('session', {}, { at });
  const { session } = start;
  let ch = start.challenge;
  assert.equal(ch.pow.bits, 4);

  const wrong = async () => {
    const answer = wrongAnswer(answers.get(ch.id));
    const r = await post(
      'verify',
      { session, challenge: ch.id, answer, nonces: prove(ch, 'verify') },
      { at }
    );
    assert.equal(r.data.result, 'wrong');
    return r.data.challenge;
  };

  ch = await wrong();
  assert.equal(ch.pow.bits, 6);
  const r = await post('reload', { session, challenge: ch.id, nonces: prove(ch, 'reload') }, { at });
  ch = r.data.challenge;
  assert.equal(ch.pow.bits, 7);
  ch = await wrong();
  assert.equal(ch.pow.bits, 9); // capped at +5

  // A fresh session from the same IP keeps the penalty; another IP starts clean.
  assert.equal((await post('session', {}, { at })).data.challenge.pow.bits, 9);
  const other = await post('session', {}, { at, headers: { 'x-test-ip': 'b' } });
  assert.equal(other.data.challenge.pow.bits, 4);
});

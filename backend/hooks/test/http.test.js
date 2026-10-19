import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmitter } from '../src/emitter.js';
import { classify, createHttpHooks } from '../src/http.js';
import { createRedis } from '../src/redis.js';
import { fakeReq, fakeRedis, fakeRes, hasher, run, writtenEvents } from './helpers.js';

const IP = '::ffff:172.18.0.5';
const IP_HASH = hasher.ip(IP);
const NOW = 1_760_800_000_000;

const setup = ({ mode, env = 'staging', redis = fakeRedis({ mode }) } = {}) => {
  const logs = [];
  const log = (msg, fields) => logs.push({ msg, fields });
  const emitter = createEmitter({ redis, timeoutMs: 50, log });
  const mw = createHttpHooks({ redis, emitter, hasher, env, inst: 'test-1', timeoutMs: 50, log, now: () => NOW });
  return { redis, logs, mw };
};

const blockValue = (rule = 'R1b', ttlMs = 300_000) => JSON.stringify({ actionId: '01JAB', rule, incidentId: '01JAA', level: 'block', expiresAt: NOW + ttlMs });

test('classify covers the guarded routes, survives case and trailing-slash tricks, skips the rest', () => {
  assert.deepEqual(classify('POST', '/api/v1/auth/login'), { scope: 'auth', route: 'login' });
  assert.deepEqual(classify('POST', '/API/V1/Auth/LOGIN/'), { scope: 'auth', route: 'login' });
  assert.deepEqual(classify('POST', '/api/v1/auth/verify-otp'), { scope: 'auth', route: 'verify_otp' });
  assert.deepEqual(classify('POST', '/api/v1/auth/resend-verification'), { scope: 'auth', route: null });
  assert.deepEqual(classify('GET', '/api/v1/rooms/XK9PLM'), { scope: 'room_join', rawCode: 'xk9plm' });
  assert.deepEqual(classify('GET', '/api/v1/rooms/xk9plm/'), { scope: 'room_join', rawCode: 'xk9plm' });
  // Excluded so sessions survive a NAT block (ARCH §7.4), or simply not ours:
  for (const [m, p] of [
    ['POST', '/api/v1/auth/refresh-token'],
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/auth/change-password'],
    ['GET', '/api/v1/auth/login'],
    ['GET', '/api/v1/rooms/permanent'],
    ['GET', '/api/v1/rooms/PERMANENT'],
    ['POST', '/api/v1/rooms'],
    ['GET', '/api/v1/users/me'],
    ['GET', '/api/v1/health'],
  ]) {
    assert.equal(classify(m, p), null, `${m} ${p}`);
  }
});

test('METADATA ONLY: a failed login emits auth.fail with hashes, never the raw email, password or IP', async () => {
  const { redis, mw } = setup();
  const req = fakeReq({ body: { email: 'Demo01@Kairo.test', password: 'hunter2-secret' } });
  const res = fakeRes();
  assert.equal(await run(mw, req, res), 1);
  res.finishWith(401);
  await new Promise((r) => setTimeout(r, 10));

  const [event] = writtenEvents(redis);
  assert.equal(event.type, 'auth.fail');
  assert.deepEqual(event.src, { ipHash: IP_HASH, client: 'unknown', authed: false });
  assert.deepEqual(event.auth, { route: 'login', status: 401, accountHash: hasher.account('demo01@kairo.test') });

  const wire = JSON.stringify(redis.xadds);
  for (const raw of ['demo01', 'Demo01', 'kairo.test', 'hunter2', '172.18.0.5']) {
    assert.ok(!wire.includes(raw), `raw value ${raw} must never reach Redis`);
  }
});

test('METADATA ONLY: a room-code miss emits room.join.invalid with a code hash, never the code', async () => {
  const { redis, mw } = setup();
  const res = fakeRes();
  assert.equal(await run(mw, fakeReq({ method: 'GET', path: '/api/v1/rooms/XK9PLM' }), res), 1);
  res.finishWith(404);
  await new Promise((r) => setTimeout(r, 10));

  const [event] = writtenEvents(redis);
  assert.equal(event.type, 'room.join.invalid');
  assert.deepEqual(event.room, { codeHash: hasher.roomCode('XK9PLM'), kind: 'ephemeral', via: 'http' });
  const wire = JSON.stringify(redis.xadds);
  assert.ok(!/xk9plm/i.test(wire), 'the room code is the room key and must never reach Redis');
});

test('success, other statuses and found rooms map correctly', async () => {
  const cases = [
    [fakeReq(), 200, 'auth.success'],
    [fakeReq(), 400, 'auth.fail'],
    [fakeReq(), 403, 'auth.fail'],
    [fakeReq(), 429, null], // CypherFy's own limiter: not counted here
    [fakeReq(), 500, null],
    [fakeReq({ path: '/api/v1/auth/resend-verification' }), 401, null], // guarded, but no event route
    [fakeReq({ method: 'GET', path: '/api/v1/rooms/XK9PLM' }), 200, null],
  ];
  for (const [req, status, expected] of cases) {
    const { redis, mw } = setup();
    const res = fakeRes();
    await run(mw, req, res);
    res.finishWith(status);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(writtenEvents(redis).map((e) => e.type), expected ? [expected] : [], `${req.path} ${status}`);
  }
});

test('unclassified requests pass straight through without touching Redis', async () => {
  const { redis, mw } = setup();
  assert.equal(await run(mw, fakeReq({ method: 'GET', path: '/api/v1/users/me' }), fakeRes()), 1);
  assert.equal(redis.calls.length, 0);
});

test('block key → 403 with Retry-After and X-Kairo-Rule, http.denied, and no auth.fail', async () => {
  const { redis, mw } = setup();
  redis.store.set(`kairo:block:auth:${IP_HASH}`, blockValue('R1b', 300_000));
  const res = fakeRes();
  assert.equal(await run(mw, fakeReq({ path: '/API/v1/auth/Login/' }), res), 0, 'CypherFy is never reached');
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['x-kairo-rule'], 'R1b');
  assert.equal(res.headers['retry-after'], '300');
  assert.deepEqual(res.body, { success: false, message: 'Temporarily blocked', retryAfter: 300 });
  const events = writtenEvents(redis);
  assert.deepEqual(events.map((e) => e.type), ['http.denied']);
  assert.deepEqual(events[0].http, { scope: 'auth', rule: 'R1b' });
});

test('room_join block applies to room lookups only', async () => {
  const { redis, mw } = setup();
  redis.store.set(`kairo:block:room_join:${IP_HASH}`, blockValue('R2a'));
  const roomRes = fakeRes();
  assert.equal(await run(mw, fakeReq({ method: 'GET', path: '/api/v1/rooms/AB2CDE' }), roomRes), 0);
  assert.equal(roomRes.statusCode, 403);
  assert.equal(await run(mw, fakeReq(), fakeRes()), 1, 'login is a different scope');
});

test('throttle key → one request per window through the token gate, then 429', async () => {
  const { redis, mw } = setup();
  redis.store.set(`kairo:throttle:auth:${IP_HASH}`, JSON.stringify({ rule: 'R1a', level: 'throttle' }));
  assert.equal(await run(mw, fakeReq(), fakeRes()), 1, 'first request passes the gate');
  const res = fakeRes();
  assert.equal(await run(mw, fakeReq(), res), 0);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['x-kairo-rule'], 'R1a');
  assert.equal(res.headers['retry-after'], '5');
});

test('allowlist and kill switch let a blocked source through', async () => {
  for (const key of [`kairo:allow:${IP_HASH}`, 'kairo:killswitch']) {
    const { redis, mw } = setup();
    redis.store.set(`kairo:block:auth:${IP_HASH}`, blockValue());
    redis.store.set(key, JSON.stringify({ by: 'test' }));
    assert.equal(await run(mw, fakeReq(), fakeRes()), 1, key);
  }
});

test('production never enforces, but still observes', async () => {
  const { redis, mw } = setup({ env: 'production' });
  redis.store.set(`kairo:block:auth:${IP_HASH}`, blockValue());
  const res = fakeRes();
  assert.equal(await run(mw, fakeReq(), res), 1);
  res.finishWith(401);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(writtenEvents(redis).map((e) => [e.type, e.env]), [['auth.fail', 'production']]);
});

test('FAIL OPEN: guard allows when Redis is refusing connections (real ioredis client)', async () => {
  const redis = createRedis('redis://127.0.0.1:1', () => {});
  try {
    const { mw, logs } = setup({ redis });
    const started = Date.now();
    let nextCalled = false;
    await new Promise((resolve) => {
      mw(fakeReq(), fakeRes(), () => {
        nextCalled = true;
        resolve();
      });
      setTimeout(resolve, 1000);
    });
    assert.equal(nextCalled, true);
    assert.ok(Date.now() - started < 200, `took ${Date.now() - started} ms`);
    assert.ok(logs.some((l) => l.msg === 'kairo.redis_unavailable'));
  } finally {
    redis.disconnect();
  }
});

test('FAIL OPEN: guard allows within the 50 ms budget when Redis hangs or errors', async () => {
  for (const mode of ['hang', 'down']) {
    const { mw } = setup({ mode });
    const started = Date.now();
    let nextCalled = false;
    await new Promise((resolve) => {
      mw(fakeReq(), fakeRes(), () => {
        nextCalled = true;
        resolve();
      });
      setTimeout(resolve, 1000);
    });
    assert.equal(nextCalled, true, mode);
    assert.ok(Date.now() - started < 150, `${mode}: took ${Date.now() - started} ms`);
  }
});

test('an exception inside the hook still calls next() exactly once', async () => {
  const brokenHasher = { ...hasher, ip: () => { throw new Error('boom'); } };
  const redis = fakeRedis();
  const logs = [];
  const mw = createHttpHooks({
    redis,
    emitter: createEmitter({ redis, timeoutMs: 50, log: () => {} }),
    hasher: brokenHasher,
    env: 'staging',
    inst: 'test-1',
    timeoutMs: 50,
    log: (msg) => logs.push(msg),
  });
  assert.equal(await run(mw, fakeReq(), fakeRes()), 1);
  assert.deepEqual(logs, ['kairo.hook_error']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEmitter } from '../src/emitter.service.js';
import { fakeRedis, writtenEvents } from './helpers.js';

const event = {
  ts: 1760800000123,
  type: 'auth.fail',
  env: 'staging',
  inst: 'cypherfy-backend-1',
  src: { ipHash: '3e9a5b0c1d2e44c1', client: 'unknown', authed: false },
  auth: { route: 'login', status: 401, accountHash: 'a91f0c3e7b2d10f8' },
};

const setup = (mode) => {
  const redis = fakeRedis({ mode });
  const logs = [];
  const emitter = createEmitter({ redis, timeoutMs: 50, log: (msg, fields) => logs.push({ msg, fields }) });
  return { redis, logs, emitter };
};

test('a valid event is written to kairo:events with MAXLEN ~ and the v/e layout', async () => {
  const { redis, emitter } = setup();
  assert.equal(await emitter.emit(event), true);
  const [args] = redis.xadds;
  assert.deepEqual(args.slice(0, 7), ['kairo:events', 'MAXLEN', '~', 100000, '*', 'v', '1']);
  assert.deepEqual(writtenEvents(redis), [event]);
});

test('ALLOWLIST: an event carrying any non-allowlisted field is never written', async () => {
  const smuggled = [
    { ...event, message: 'hello' },
    { ...event, ciphertext: 'AAEC' },
    { ...event, src: { ...event.src, ip: '172.18.0.5' } },
    { ...event, auth: { ...event.auth, email: 'demo01@kairo.test' } },
    { ...event, auth: { ...event.auth, password: 'hunter2' } },
    { ...event, auth: { ...event.auth, accountHash: 'demo01@kairo.test' } },
  ];
  for (const bad of smuggled) {
    const { redis, logs, emitter } = setup();
    assert.equal(await emitter.emit(bad), false);
    assert.equal(redis.xadds.length, 0, 'nothing reaches Redis');
    assert.equal(logs[0].msg, 'kairo.event_invalid');
    const logged = JSON.stringify(logs);
    for (const raw of ['hello', 'AAEC', '172.18.0.5', 'demo01', 'hunter2']) {
      assert.ok(!logged.includes(raw), `the log must not repeat the rejected value ${raw}`);
    }
  }
});

test('ALLOWLIST: socket events cannot carry payloads, message text or raw codes either', async () => {
  const src = { ...event.src, socketId: 'f21c9Qk3xY0aBcD' };
  const rate = { ts: event.ts, type: 'socket.rate', env: 'staging', inst: 'cypherfy-backend-1', src, sock: { counts: { send_message: 2 }, total: 2, windowMs: 1000 } };
  const smuggled = [
    { ...rate, sock: { ...rate.sock, payload: 'hello' } },
    { ...rate, ciphertext: 'AAEC' },
    { ...rate, sock: { ...rate.sock, counts: { 'hello there friend': 1 } } },
    { ...rate, type: 'socket.invalid_payload', sock: { event: 'send_message', payload: 'hello' } },
    { ...rate, type: 'room.join.invalid', sock: undefined, room: { codeHash: 'XK9PLM', kind: 'ephemeral', via: 'socket' } },
    { ...rate, type: 'room.join.invalid', sock: undefined, room: { codeHash: '3e9a5b0c1d2e44c1', kind: 'ephemeral', via: 'socket', code: 'XK9PLM' } },
  ];
  for (const bad of smuggled) {
    const { redis, logs, emitter } = setup();
    assert.equal(await emitter.emit(bad), false, JSON.stringify(Object.keys(bad)));
    assert.equal(redis.xadds.length, 0, 'nothing reaches Redis');
    const logged = JSON.stringify(logs);
    for (const raw of ['hello', 'AAEC', 'XK9PLM']) assert.ok(!logged.includes(raw), `the log must not repeat ${raw}`);
  }
});

test('emit never throws when Redis is down or hangs', async () => {
  for (const mode of ['down', 'hang']) {
    const { emitter, logs } = setup(mode);
    const started = Date.now();
    assert.equal(await emitter.emit(event), false);
    assert.ok(Date.now() - started < 500, `${mode}: gives up quickly`);
    assert.equal(logs[0].msg, 'kairo.redis_unavailable');
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHeartbeat, HEARTBEAT_TTL_MS } from '../src/heartbeat.service.js';
import { createEmitter } from '../src/emitter.service.js';
import { fakeRedis } from './helpers.js';

const event = {
  ts: 1760800000123,
  type: 'auth.fail',
  env: 'staging',
  inst: 'cypherfy-backend-1',
  src: { ipHash: '3e9a5b0c1d2e44c1', client: 'unknown', authed: false },
  auth: { route: 'login', status: 401 },
};

test('the heartbeat key holds the beat time and the last event written, with a 30 s TTL', async () => {
  const redis = fakeRedis();
  const emitter = createEmitter({ redis, timeoutMs: 50, log: () => {} });
  const hb = createHeartbeat({ redis, emitter, inst: 'cypherfy-backend-1', timeoutMs: 50, log: () => {}, now: () => 5000, everyMs: 0 });
  await hb.beat();
  assert.deepEqual(JSON.parse(redis.store.get('kairo:hb:hooks:cypherfy-backend-1')), { at: 5000, lastEventAt: null });
  await emitter.emit(event);
  await hb.beat();
  assert.deepEqual(JSON.parse(redis.store.get('kairo:hb:hooks:cypherfy-backend-1')), { at: 5000, lastEventAt: event.ts });
  assert.equal(HEARTBEAT_TTL_MS, 30_000);
});

test('a heartbeat with Redis down or hanging never throws', async () => {
  for (const mode of ['down', 'hang']) {
    const logs = [];
    const redis = fakeRedis({ mode });
    const hb = createHeartbeat({ redis, emitter: { lastEventAt: null }, inst: 'x', timeoutMs: 20, log: (m) => logs.push(m), everyMs: 0 });
    await hb.beat();
    assert.deepEqual(logs, ['kairo.redis_unavailable']);
  }
});

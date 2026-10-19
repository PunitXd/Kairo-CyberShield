import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createBlockWatcher, listBlocks } from '../../src/services/block.service.js';
import { fakeRedis } from '../apiFakes.js';

const H = '3e9a5b0c1d2e44c1';

test('listBlocks skips malformed keys and keys that expired between SCAN and GET', async () => {
  const redis = fakeRedis({
    keys: {
      [`kairo:block:auth:${H}`]: { value: '{"rule":"R1b"}', pttl: 5000 },
      'kairo:block:auth:not-a-hash': { value: '{}', pttl: 5000 },
      [`kairo:block:room_join:${H}`]: { value: '{"rule":"R2a"}', pttl: -2 },
      [`kairo:throttle:auth:${H}`]: { value: 'not json', pttl: 3000 },
    },
  });
  const items = await listBlocks(redis, { now: 1000 });
  assert.deepEqual(
    items.map((i) => [i.level, i.scope, i.rule, i.ttlMs, i.expiresAt]),
    [
      ['block', 'auth', 'R1b', 5000, 6000],
      ['throttle', 'auth', null, 3000, 4000],
    ]
  );
});

test('the watcher publishes block.removed when a block expires on its own', async () => {
  const redis = fakeRedis({ keys: { [`kairo:block:auth:${H}`]: { value: '{"rule":"R1b"}', pttl: 5000 } } });
  const bus = new EventEmitter();
  const removed = [];
  bus.on('block.removed', (item) => removed.push(item));
  const watcher = createBlockWatcher({ redis, bus, intervalMs: 60_000 });
  await watcher.start();
  watcher.stop();
  assert.equal(removed.length, 0, 'nothing removed at start');

  delete redis.keys[`kairo:block:auth:${H}`]; // TTL ran out
  await watcher.tick();
  assert.deepEqual(removed.map((r) => [r.scope, r.subject, r.rule, r.reason]), [['auth', H, 'R1b', 'expired']]);

  await watcher.tick();
  assert.equal(removed.length, 1, 'published once, not on every tick');
});

test('the watcher also tracks blocks announced on the bus', async () => {
  const redis = fakeRedis({ keys: {} });
  const bus = new EventEmitter();
  const removed = [];
  bus.on('block.removed', (item) => removed.push(item));
  const watcher = createBlockWatcher({ redis, bus, intervalMs: 60_000 });
  await watcher.start();
  watcher.stop();
  bus.emit('block.added', { level: 'block', scope: 'room_join', subject: H, rule: 'R2a' });
  await watcher.tick(); // the key is already gone from Redis
  assert.deepEqual(removed.map((r) => r.rule), ['R2a']);
});

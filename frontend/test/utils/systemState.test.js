import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionBlockedReason, isRedisDown, isStale, systemBanner } from '../../src/utils/systemState.js';

const clock = () => '14:02:11';
const ok = { redis: 'ok' };
const redisDown = { redis: 'down' };

test('no band while everything is connected, or during a short reconnect', () => {
  assert.equal(systemBanner({ connection: 'live', status: ok }, clock), null);
  assert.equal(systemBanner({ connection: 'reconnecting', status: ok }, clock), null);
  assert.equal(systemBanner({ connection: 'connecting', status: null }, clock), null);
});

test('Defender unreachable for 10 s: warning band with the time it was lost', () => {
  const band = systemBanner({ connection: 'down', connectionSince: 1, status: redisDown }, clock);
  assert.equal(band.kind, 'defender'); // wins over a stale Redis status
  assert.equal(band.tone, 'warning');
  assert.equal(band.text, 'Lost connection to Defender at 14:02:11. Blocks already in Redis still apply and still expire. Retrying every 5 s.');
});

test('Redis unreachable: critical "Protection paused" band', () => {
  const band = systemBanner({ connection: 'live', status: redisDown }, clock);
  assert.equal(band.kind, 'redis');
  assert.equal(band.tone, 'critical');
  assert.match(band.text, /^Protection paused: Redis is unreachable, so CypherFy is allowing all traffic\. No blocks are being enforced\.$/);
});

test('stale only after 10 s; actions need a live Defender and Redis', () => {
  assert.equal(isStale('reconnecting'), false);
  assert.equal(isStale('down'), true);
  assert.equal(isRedisDown('live', redisDown), true);
  assert.equal(isRedisDown('down', redisDown), false);
  assert.equal(actionBlockedReason('live', ok), null);
  assert.match(actionBlockedReason('reconnecting', ok), /Defender is unreachable/);
  assert.match(actionBlockedReason('live', redisDown), /Redis is unreachable/);
});

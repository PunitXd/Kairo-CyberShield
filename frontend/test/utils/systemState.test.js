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

test('R4 frozen: critical rollback band, after the Defender and Redis bands', () => {
  const status = { redis: 'ok', rollback: { frozen: true, frozenReason: 'rollback budget used' }, cypherfy: { ok: true }, hooks: [{ alive: true }] };
  const band = systemBanner({ connection: 'live', status }, clock);
  assert.equal(band.kind, 'rollback');
  assert.equal(band.tone, 'critical');
  assert.match(band.text, /^Rollback paused \(rollback budget used\)\./);
  assert.equal(systemBanner({ connection: 'live', status: { ...status, redis: 'down' } }, clock).kind, 'redis');
});

test('hooks silent: CypherFy healthy but no live hooks heartbeat → warning band (BRIEF D5)', () => {
  const band = systemBanner({ connection: 'live', status: { redis: 'ok', cypherfy: { ok: true }, hooks: [{ inst: 'cypherfy-backend-1', alive: false }] } }, clock);
  assert.equal(band.kind, 'hooks');
  assert.equal(band.text, 'No events from CypherFy for 60 s. Check that cypherfy-hooks is loaded.');
  assert.equal(systemBanner({ connection: 'live', status: { redis: 'ok', cypherfy: { ok: true }, hooks: [{ alive: true }] } }, clock), null);
  assert.equal(systemBanner({ connection: 'live', status: { redis: 'ok', cypherfy: { ok: false }, hooks: [] } }, clock), null, 'CypherFy down is not a hooks problem');
});

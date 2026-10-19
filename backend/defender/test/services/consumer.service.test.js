import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toStreamFields } from 'kairo-schema';

import { createConsumer } from '../../src/services/consumer.service.js';

const event = (ts) => ({
  ts,
  type: 'auth.fail',
  env: 'staging',
  inst: 'cypherfy-backend-1',
  src: { ipHash: '3e9a5b0c1d2e44c1', client: 'unknown', authed: false },
  auth: { route: 'login', status: 401, accountHash: 'a'.repeat(16) },
});

const recordingLog = () => {
  const lines = [];
  const at = (level) => (o) => lines.push({ level, ...o });
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
};

test('a Redis outage is logged once as redis.down and once as redis.up, and a lost group is recreated', async () => {
  const now = Date.now();
  // What each XREADGROUP '>' call does, in order.
  const script = [
    () => Promise.reject(new Error('Connection is closed.')),
    () => Promise.reject(new Error('Connection is closed.')),
    () => Promise.reject(new Error('Connection is closed.')),
    () => Promise.reject(new Error("NOGROUP No such key 'kairo:events' or consumer group 'defender'")),
    () => Promise.resolve([['kairo:events', [['1-0', toStreamFields(event(now))]]]]),
  ];
  let groupCreates = 0;
  const acked = [];
  let consumer;
  const redis = {
    xgroup: async () => void groupCreates++,
    xack: async (_k, _g, ...ids) => void acked.push(...ids),
    xreadgroup: async (...args) => {
      if (args.at(-1) === '0') return null; // nothing pending
      const step = script.shift();
      if (!step) {
        consumer.stop();
        return null;
      }
      return step();
    },
  };
  const handled = [];
  const log = recordingLog();
  consumer = createConsumer({ redis, runner: { handle: async (e) => void handled.push(e) }, log, getStaleMs: () => 60_000, retryMs: 1 });

  await consumer.run();

  const msgs = log.lines.map((l) => l.msg);
  assert.deepEqual(msgs.filter((m) => m.startsWith('redis.')), ['redis.down', 'redis.up']);
  assert.equal(groupCreates, 2, 'created at start, and again after NOGROUP');
  assert.equal(handled.length, 1, 'the event after recovery is processed');
  assert.deepEqual(acked, ['1-0']);
});

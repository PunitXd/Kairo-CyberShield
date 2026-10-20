import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { fakeMongo, listen, rawGet } from './apiFakes.js';
import { CONFIG } from './helpers.js';

const NOW = Date.now();
const ID = (n) => `01JAB0000000000000000000${n}`;
const H = '3e9a5b0c1d2e44c1';
const calls = [];
let server;
let port;

before(async () => {
  const mongo = fakeMongo({
    incidents: [
      { _id: ID('01'), family: 'auth', ruleId: 'R1b', subject: H, firstEventTs: NOW - 30_000, lastSeenAt: new Date(NOW - 5000), detectedAt: new Date(NOW - 25_000) },
      { _id: ID('02'), family: 'deploy', ruleId: 'R4', subject: 'abc1234', firstEventTs: NOW - 30_000, lastSeenAt: new Date(NOW) },
      { _id: ID('03'), family: 'room', ruleId: 'R2a', subject: H, firstEventTs: NOW - 3_600_000, lastSeenAt: new Date(NOW - 3_500_000) },
    ],
  });
  const getSeries = (ruleId, subject, q) => {
    if (q.to < q.from) return { available: false, points: [], oldestMs: NOW - 31_000 }; // the "how old is the data" probe
    calls.push({ ruleId, subject, ...q });
    return { available: true, points: [{ t: q.from, n: 1, w: 1 }], oldestMs: q.from };
  };
  server = createServer(createApp({ redis: {}, mongo, env: 'staging', getSeries, getConfig: () => CONFIG, getConsumerStats: () => ({}), getRules: () => [] }));
  port = await listen(server);
});
after(() => server.close());

test('an auth incident charts R1a for its source: one window before the first event to now, ≤ 120 steps', async () => {
  const { status, body } = await rawGet(port, `/api/incidents/${ID('01')}/series`);
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.ruleId, 'R1a');
  assert.equal(body.threshold, 5);
  assert.equal(body.windowMs, 60_000);
  assert.equal(calls[0].subject, H);
  assert.ok(Math.abs(calls[0].from - (NOW - 35_000)) < 2000, 'from = 5 s before the first event');
  assert.ok(body.until >= body.from + 60_000, 'the axis spans at least one window');
  assert.ok((body.until - body.from) / body.stepMs <= 120);
});

test('deploy incidents have no attempt series; old incidents say expired; 404 / 400 as usual', async () => {
  assert.deepEqual((await rawGet(port, `/api/incidents/${ID('02')}/series`)).body, { available: false, reason: 'no_series', ruleId: null });
  const old = (await rawGet(port, `/api/incidents/${ID('03')}/series`)).body;
  assert.equal(old.available, false);
  assert.equal(old.reason, 'expired');
  assert.equal((await rawGet(port, `/api/incidents/${ID('99')}/series`)).status, 404);
  assert.equal((await rawGet(port, '/api/incidents/nope/series')).status, 400);
});

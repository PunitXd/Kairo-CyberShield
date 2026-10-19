import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { fakeMongo, fakeRedis, listen, rawGet } from './apiFakes.js';

const runDoc = (id, startedAt, over = {}) => ({
  _id: id,
  repo: 'PunitXd/CypherFy',
  branch: 'kairo',
  sha: 'a'.repeat(40),
  event: 'push',
  status: 'passed',
  reason: null,
  startedAt: new Date(startedAt),
  finishedAt: new Date(startedAt + 30_000),
  jobs: [],
  findings: [],
  ...over,
});

const runs = [
  runDoc(1, Date.parse('2026-10-19T16:00:00Z')),
  runDoc(3, Date.parse('2026-10-19T16:52:51Z'), {
    branch: 'demo/leaked-secret',
    status: 'blocked',
    reason: 'secret',
    findings: [{ tool: 'gitleaks', ruleId: 'aws-access-token', file: 'backend/src/config/storage.js', line: 8, redacted: 'AKIA••••••••' }],
  }),
  runDoc(2, Date.parse('2026-10-19T16:30:00Z')),
];
const sync = { repo: 'PunitXd/CypherFy', ok: false, error: 'unreachable', lastSuccessAt: new Date('2026-10-19T16:55:00Z'), tokenConfigured: true };

let server;
let port;
before(async () => {
  const deps = { redis: fakeRedis(), mongo: fakeMongo({ pipelineRuns: runs }), env: 'staging', getConsumerStats: () => ({}), getRules: () => [], getPipelineSync: () => sync };
  server = createServer(createApp(deps));
  port = await listen(server);
});
after(() => server.close());

test('GET /api/pipeline/runs lists runs newest first, with the sync state', async () => {
  const { status, body } = await rawGet(port, '/api/pipeline/runs');
  assert.equal(status, 200);
  assert.deepEqual(body.items.map((r) => r._id), [3, 2, 1]);
  assert.equal(body.sync.error, 'unreachable');
  assert.equal(body.sync.lastSuccessAt, '2026-10-19T16:55:00.000Z');
  assert.equal((await rawGet(port, '/api/pipeline/runs?limit=1')).body.items.length, 1);
});

test('GET /api/pipeline/runs validates its query', async () => {
  for (const bad of ['limit=0', 'limit=51', 'limit=x', 'other=1']) {
    assert.equal((await rawGet(port, `/api/pipeline/runs?${bad}`)).status, 400, bad);
  }
});

test('GET /api/pipeline/runs/:id returns one run, 404 when unknown, 400 when not a run id', async () => {
  const one = await rawGet(port, '/api/pipeline/runs/3');
  assert.equal(one.status, 200);
  assert.equal(one.body.run.findings[0].redacted, 'AKIA••••••••');
  assert.equal((await rawGet(port, '/api/pipeline/runs/99')).status, 404);
  for (const bad of ['abc', '0', '1e5', '-1', '12345678901234567']) {
    assert.equal((await rawGet(port, `/api/pipeline/runs/${bad}`)).status, 400, bad);
  }
});

test('GET /api/overview reports the newest run as the Last pipeline KPI', async () => {
  const { body } = await rawGet(port, '/api/overview');
  assert.deepEqual(body.lastPipeline, {
    id: 3,
    status: 'blocked',
    reason: 'secret',
    branch: 'demo/leaked-secret',
    sha: 'aaaaaaa',
    event: 'push',
    finishedAt: '2026-10-19T16:53:21.000Z',
  });
});

test('pipeline routes report poller_off when no poller is configured', async () => {
  const off = createServer(createApp({ redis: fakeRedis(), mongo: fakeMongo(), env: 'staging', getConsumerStats: () => ({}), getRules: () => [] }));
  const offPort = await listen(off);
  try {
    const { body } = await rawGet(offPort, '/api/pipeline/runs');
    assert.deepEqual(body.items, []);
    assert.equal(body.sync.error, 'poller_off');
  } finally {
    off.close();
  }
});

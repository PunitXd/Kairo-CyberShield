import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { fakeMongo, fakeRedis, listen, rawGet } from './apiFakes.js';

const H1 = '3e9a5b0c1d2e44c1';
const H2 = '77b0e2aa91c0d3e2';
const NOW = Date.now();
const silentLog = { info() {}, warn() {}, error() {} };

const incidents = Array.from({ length: 5 }, (_, i) => ({
  _id: `01JAB0000000000000000000${String(i).padStart(2, '0')}`, // ulid-shaped, sortable
  ruleId: i % 2 ? 'R2a' : 'R1b',
  severity: i % 2 ? 'medium' : 'high',
  status: 'open',
  subject: H1,
  detectedAt: new Date(NOW - i * 60_000),
}));

const deps = {
  redis: fakeRedis({
    keys: {
      [`kairo:block:auth:${H1}`]: { value: JSON.stringify({ rule: 'R1b', actionId: 'a1', incidentId: 'i1' }), pttl: 299_000 },
      [`kairo:throttle:auth:${H1}`]: { value: JSON.stringify({ rule: 'R1a', actionId: 'a0', incidentId: 'i1' }), pttl: 120_000 },
      [`kairo:block:room_join:${H2}`]: { value: JSON.stringify({ rule: 'R2a', actionId: 'a2', incidentId: 'i2' }), pttl: 60_000 },
      'kairo:killswitch': { value: '{"by":"test"}', pttl: -1 },
    },
  }),
  mongo: fakeMongo({
    incidents,
    actions: [
      { result: 'applied', appliedAt: new Date(NOW - 1000), ttdMs: 3, latencyMs: 8 },
      { result: 'applied', appliedAt: new Date(NOW - 2000), ttdMs: 19, latencyMs: 20 },
      { result: 'skipped_shadow', appliedAt: null, ttdMs: 999, latencyMs: null },
    ],
  }),
  env: 'staging',
  log: silentLog,
  getConsumerStats: () => ({ lastEventTs: NOW - 500, lastEventAtByInst: { 'cypherfy-backend-1': NOW - 500 } }),
  getRules: () => [{ id: 'R1a', mode: 'enforce' }, { id: 'R1b', mode: 'enforce' }, { id: 'R2a', mode: 'shadow' }],
};

let server;
let port;
before(async () => {
  server = createServer(createApp(deps));
  port = await listen(server);
});
after(() => server.close());

test('GET /api/health reports every dependency, the kill switch and the hooks heartbeat', async () => {
  const { status, body, headers } = await rawGet(port, '/api/health');
  assert.equal(status, 200);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers['access-control-allow-origin'], undefined, 'no CORS, ever');
  assert.deepEqual(
    { defender: body.defender, redis: body.redis, mongo: body.mongo, killSwitch: body.killSwitch, env: body.env },
    { defender: 'ok', redis: 'ok', mongo: 'ok', killSwitch: true, env: 'staging' }
  );
  assert.ok(body.consumerLagMs >= 500 && body.consumerLagMs < 5000);
  assert.deepEqual(body.hooks.map((h) => h.inst), ['cypherfy-backend-1']);
  assert.deepEqual(body.rules, [{ id: 'R1a', mode: 'enforce' }, { id: 'R1b', mode: 'enforce' }, { id: 'R2a', mode: 'shadow' }]);
});

test('GET /api/health says "down" instead of failing when Redis or Mongo is down', async () => {
  const s = createServer(createApp({ ...deps, redis: fakeRedis({ down: true }), mongo: fakeMongo({ down: true }) }));
  const p = await listen(s);
  try {
    const { status, body } = await rawGet(p, '/api/health');
    assert.equal(status, 200);
    assert.equal(body.redis, 'down');
    assert.equal(body.mongo, 'down');
    assert.equal(body.killSwitch, false);
  } finally {
    s.close();
  }
});

test('GET /api/blocks lists blocks and throttles from Redis, filterable by scope', async () => {
  const all = await rawGet(port, '/api/blocks');
  assert.equal(all.status, 200);
  assert.equal(all.body.items.length, 3);
  const block = all.body.items.find((b) => b.level === 'block' && b.scope === 'auth');
  assert.deepEqual(
    { scope: block.scope, subject: block.subject, level: block.level, rule: block.rule, ttlMs: block.ttlMs, actionId: block.actionId, incidentId: block.incidentId },
    { scope: 'auth', subject: H1, level: 'block', rule: 'R1b', ttlMs: 299_000, actionId: 'a1', incidentId: 'i1' }
  );

  const room = await rawGet(port, '/api/blocks?scope=room_join');
  assert.deepEqual(room.body.items.map((b) => [b.scope, b.rule]), [['room_join', 'R2a']]);

  const bad = await rawGet(port, '/api/blocks?scope=everything');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_QUERY');
});

test('GET /api/overview computes p95 TTD/TTR from enforced actions only; counts blocks, not throttles', async () => {
  const { status, body } = await rawGet(port, '/api/overview');
  assert.equal(status, 200);
  assert.deepEqual(body, { activeBlocks: 2, ttdP95Ms: 19, ttrP95Ms: 20, incidents24h: 5, lastPipeline: null });
});

test('GET /api/incidents is newest first, filterable, and cursor-paginated', async () => {
  const page1 = await rawGet(port, '/api/incidents?limit=2');
  assert.equal(page1.status, 200);
  assert.deepEqual(page1.body.items.map((i) => i._id.slice(-2)), ['04', '03']);
  assert.equal(page1.body.nextCursor, page1.body.items[1]._id);

  const page2 = await rawGet(port, `/api/incidents?limit=2&cursor=${page1.body.nextCursor}`);
  assert.deepEqual(page2.body.items.map((i) => i._id.slice(-2)), ['02', '01']);

  const last = await rawGet(port, `/api/incidents?limit=2&cursor=${page2.body.nextCursor}`);
  assert.deepEqual(last.body.items.map((i) => i._id.slice(-2)), ['00']);
  assert.equal(last.body.nextCursor, null);

  const r2a = await rawGet(port, '/api/incidents?ruleId=R2a');
  assert.ok(r2a.body.items.length === 2 && r2a.body.items.every((i) => i.ruleId === 'R2a'));
});

test('GET /api/incidents rejects bad or unknown parameters without echoing them', async () => {
  for (const q of ['limit=0', 'limit=500', 'status=deleted', 'cursor=not-a-ulid', 'ruleId=$ne', 'evil=1', 'status=open&status=shadow']) {
    const { status, body } = await rawGet(port, `/api/incidents?${q}`);
    assert.equal(status, 400, q);
    assert.equal(body.error.code, 'INVALID_QUERY', q);
    assert.ok(!JSON.stringify(body).includes('$ne') && !JSON.stringify(body).includes('not-a-ulid'), `${q}: value not echoed`);
  }
});

test('the console refuses a foreign Host (DNS rebinding) and a cross-site Origin', async () => {
  const rebound = await rawGet(port, '/api/blocks', { host: 'attacker.example:7070' });
  assert.equal(rebound.status, 403);
  assert.equal(rebound.body.error.code, 'FORBIDDEN_HOST');

  const crossSite = await rawGet(port, '/api/blocks', { origin: 'https://attacker.example' });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.body.error.code, 'FORBIDDEN_ORIGIN');

  for (const host of ['localhost:7070', `127.0.0.1:${port}`, '[::1]:7070']) {
    assert.equal((await rawGet(port, '/api/health', { host })).status, 200, host);
  }
  assert.equal((await rawGet(port, '/api/health', { origin: `http://127.0.0.1:${port}` })).status, 200, 'same origin is fine');
});

test('unknown routes return the ARCH error shape', async () => {
  const { status, body } = await rawGet(port, '/api/nope');
  assert.equal(status, 404);
  assert.deepEqual(body, { error: { code: 'NOT_FOUND', message: 'Resource not found' } });
});

test('no response ever contains a raw IP address', async () => {
  for (const path of ['/api/health', '/api/blocks', '/api/overview', '/api/incidents']) {
    const { body } = await rawGet(port, path);
    assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(JSON.stringify(body)), path);
  }
});

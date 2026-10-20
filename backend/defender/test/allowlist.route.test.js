import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

import { createHasher } from 'kairo-schema';

import { createApp } from '../src/app.js';
import { createAllowlistService } from '../src/services/allowlist.service.js';
import { listen, rawGet, rawRequest } from './apiFakes.js';
import { T0 } from './helpers.js';

const json = { 'content-type': 'application/json' };
const quiet = { info() {}, warn() {}, error() {} };
const hasher = createHasher('test-secret-that-is-long-enough-1234');
const INCIDENT_ID = '01JAA0000000000000000000AA';
const SUBJECT = '3e9a5b0c1d2e44c1';
let server;
let port;
let state;

// Redis: just the calls the allowlist uses, with real TTL bookkeeping.
const fakeRedis = () => {
  const kv = new Map();
  const live = (k) => {
    const e = kv.get(k);
    if (e && e.exp <= Date.now()) kv.delete(k);
    return kv.get(k);
  };
  return {
    kv,
    status: 'ready',
    set: async (k, v, _px, ms) => kv.set(k, { v, exp: Date.now() + ms }) && 'OK',
    pttl: async (k) => (live(k) ? live(k).exp - Date.now() : -2),
    del: async (k) => (live(k) && kv.delete(k) ? 1 : 0),
    mget: async (...ks) => ks.map((k) => live(k)?.v ?? null),
    scan: async (_c, _m, pattern) => ['0', [...kv.keys()].filter((k) => live(k) && k.startsWith(pattern.replace('*', '')))],
    ping: async () => 'PONG',
  };
};

const fakeMongo = () => {
  const incidents = [{ _id: INCIDENT_ID, ruleId: 'R1b', subject: SUBJECT, status: 'open', falsePositive: false }];
  const allowlist = [];
  const audit = [];
  return {
    audit,
    allowlistDocs: allowlist,
    incidentsDocs: incidents,
    db: { command: async () => ({ ok: 1 }) },
    auditLog: { insertOne: async (d) => audit.push(d) },
    incidents: {
      findOne: async ({ _id }) => incidents.find((i) => i._id === _id) ?? null,
      updateOne: async ({ _id }, { $set }) => Object.assign(incidents.find((i) => i._id === _id), $set),
    },
    allowlist: {
      updateOne: async ({ subject }, { $set }) => {
        const i = allowlist.findIndex((d) => d.subject === subject);
        if (i >= 0) allowlist[i] = { ...allowlist[i], ...$set };
        else allowlist.push({ ...$set });
      },
      deleteOne: async ({ subject }) => allowlist.splice(allowlist.findIndex((d) => d.subject === subject), 1),
      find: ({ subject }) => ({ toArray: async () => allowlist.filter((d) => subject.$in.includes(d.subject)) }),
    },
  };
};

beforeEach(() => {
  const redis = fakeRedis();
  const mongo = fakeMongo();
  const bus = new EventEmitter();
  const events = [];
  bus.on('allowlist.changed', (e) => events.push(['allowlist.changed', e]));
  bus.on('incident.updated', (e) => events.push(['incident.updated', e._id]));
  const allowlist = createAllowlistService({ redis, mongo, bus, log: quiet, hasher, now: () => Date.now() });
  state.deps = { redis, mongo, env: 'staging', log: quiet, allowlist, hasher, bus, getConsumerStats: () => ({}), getRules: () => [] };
  state.redis = redis;
  state.mongo = mongo;
  state.events = events;
});

before(async () => {
  state = {};
  // One server; each request reads the current deps from app.locals.
  const app = createApp(new Proxy({}, { get: (_t, k) => state.deps?.[k] }));
  server = createServer(app);
  port = await listen(server);
});
after(() => server.close());

const post = (path, body) => rawRequest(port, 'POST', path, { headers: json, body: JSON.stringify(body) });

test('POST /api/allowlist hashes a typed IP server-side and never echoes or stores it', async () => {
  const res = await post('/api/allowlist', { ip: '192.168.1.42', reason: 'presenter phone', hours: 12 });
  assert.equal(res.status, 201);
  const hash = hasher.ip('192.168.1.42');
  assert.equal(res.body.entry.subject, hash);
  assert.ok(!JSON.stringify(res.body).includes('192.168.1.42'));
  assert.ok(!JSON.stringify(state.mongo.allowlistDocs).includes('192.168.1.42'));
  assert.ok(!JSON.stringify(state.mongo.audit).includes('192.168.1.42'));
  const ttl = await state.redis.pttl(`kairo:allow:${hash}`);
  assert.ok(ttl > 11.9 * 3600_000 && ttl <= 12 * 3600_000, 'key expires in 12 h');
  assert.equal(state.mongo.audit[0].op, 'allowlist_add');

  const list = await rawGet(port, '/api/allowlist');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].reason, 'presenter phone');
});

test('POST /api/allowlist validates: one of ip/subject, 1–24 h, no personal data in the reason', async () => {
  for (const body of [
    {},
    { ip: '1.2.3.4', subject: SUBJECT },
    { ip: 'not-an-ip' },
    { subject: SUBJECT, hours: 25 },
    { subject: SUBJECT, hours: 0 },
    { subject: SUBJECT, reason: 'user a@b.com' },
    { subject: SUBJECT, reason: 'from 10.0.0.7' },
    { subject: SUBJECT, extra: 1 },
  ]) {
    assert.equal((await post('/api/allowlist', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(state.redis.kv.size, 0, 'nothing allowlisted');
});

test('DELETE /api/allowlist/:subject removes it (404 when absent) and audits', async () => {
  await post('/api/allowlist', { subject: SUBJECT, hours: 1 });
  const del = await rawRequest(port, 'DELETE', `/api/allowlist/${SUBJECT}`);
  assert.deepEqual(del.body, { removed: true });
  assert.equal(await state.redis.pttl(`kairo:allow:${SUBJECT}`), -2);
  assert.equal(state.mongo.audit.at(-1).op, 'allowlist_remove');
  assert.equal((await rawRequest(port, 'DELETE', `/api/allowlist/${SUBJECT}`)).status, 404);
  assert.equal((await rawRequest(port, 'DELETE', '/api/allowlist/1.2.3.4')).status, 400);
});

test('POST /api/incidents/:id/false-positive marks it, audits, and can allowlist the source for 24 h', async () => {
  const res = await post(`/api/incidents/${INCIDENT_ID}/false-positive`, { note: 'campus wifi', allowlistHours: 24 });
  assert.equal(res.status, 200);
  assert.equal(res.body.incident.falsePositive, true);
  assert.equal(res.body.allowlisted.subject, SUBJECT);
  assert.equal(res.body.allowlisted.source, 'false_positive');
  assert.ok((await state.redis.pttl(`kairo:allow:${SUBJECT}`)) > 23.9 * 3600_000);
  assert.deepEqual(state.mongo.audit.map((a) => a.op), ['mark_fp', 'allowlist_add']);
  assert.deepEqual(state.events.map((e) => e[0]), ['allowlist.changed', 'incident.updated']);

  const again = await post(`/api/incidents/${INCIDENT_ID}/false-positive`, {});
  assert.equal(again.status, 200);
  assert.equal(state.mongo.audit.filter((a) => a.op === 'mark_fp').length, 1, 'marking twice audits once');
});

test('false-positive: 404 for an unknown incident, 400 for a bad body, 503 when allowlisting without Redis', async () => {
  assert.equal((await post('/api/incidents/01JAA0000000000000000000ZZ/false-positive', {})).status, 404);
  assert.equal((await post(`/api/incidents/${INCIDENT_ID}/false-positive`, { allowlistHours: 48 })).status, 400);
  state.redis.status = 'reconnecting';
  const res = await post(`/api/incidents/${INCIDENT_ID}/false-positive`, { allowlistHours: 24 });
  assert.equal(res.status, 503);
  assert.equal(state.mongo.incidentsDocs[0].falsePositive, false, 'nothing changed');
});

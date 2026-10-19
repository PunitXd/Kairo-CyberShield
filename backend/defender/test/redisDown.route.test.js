// Redis down (ARCH §12): Redis-backed API calls answer 503 at once instead of
// hanging, writes are refused rather than queued, and the overview still
// returns its Mongo-backed numbers with active blocks unknown.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { fakeMongo, fakeRedis, listen, rawGet, rawRequest } from './apiFakes.js';

let server;
let port;
let writes = 0;
before(async () => {
  // ioredis reports 'reconnecting' while Redis is gone; every command would sit in its offline queue.
  const hanging = () => new Promise(() => {});
  const redis = { ...fakeRedis(), status: 'reconnecting', scan: hanging, get: hanging, ping: hanging };
  const count = async () => {
    writes++;
    return {};
  };
  const deps = {
    redis,
    mongo: fakeMongo(),
    env: 'staging',
    getConsumerStats: () => ({}),
    getRules: () => [],
    unblock: { unblock: count, undo: count },
    killSwitch: { set: count },
  };
  server = createServer(createApp(deps));
  port = await listen(server);
});
after(() => server.close());

const json = { 'content-type': 'application/json' }; // no Origin header: the localhost guard lets it through

test('GET /api/blocks answers 503 REDIS_UNAVAILABLE at once', async () => {
  const started = Date.now();
  const { status, body } = await rawGet(port, '/api/blocks');
  assert.equal(status, 503);
  assert.equal(body.error.code, 'REDIS_UNAVAILABLE');
  assert.ok(Date.now() - started < 500, 'no waiting on the offline queue');
});

test('unblock, undo and the kill switch are refused, never queued', async () => {
  const del = await rawRequest(port, 'DELETE', '/api/blocks/auth/3e9a5b0c1d2e44c1');
  const undo = await rawRequest(port, 'POST', '/api/blocks/undo', { headers: json, body: JSON.stringify({ undoToken: 'a'.repeat(32) }) });
  const ks = await rawRequest(port, 'POST', '/api/killswitch', { headers: json, body: JSON.stringify({ on: true }) });
  for (const r of [del, undo, ks]) {
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'REDIS_UNAVAILABLE');
  }
  assert.equal(writes, 0);
});

test('GET /api/overview still answers, with active blocks unknown', async () => {
  const { status, body } = await rawGet(port, '/api/overview');
  assert.equal(status, 200);
  assert.equal(body.activeBlocks, null);
  assert.equal(body.incidents24h, 0);
});

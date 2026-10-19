import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { fakeMongo, fakeRedis, listen, rawRequest } from './apiFakes.js';

const H = '3e9a5b0c1d2e44c1';
const TOKEN = 'a'.repeat(32);
const calls = [];

// Stub service: the HTTP layer is under test here; unblock.service.test.js covers the logic.
const unblock = {
  unblock: async (scope, subject, opts) => {
    calls.push(['unblock', scope, subject, opts]);
    return subject === H ? { undoToken: TOKEN, undoExpiresAt: 1, removed: 2 } : null;
  },
  undo: async (token) => {
    calls.push(['undo', token]);
    return token === TOKEN ? { restored: 2 } : null;
  },
};

let server;
let port;
before(async () => {
  server = createServer(createApp({ redis: fakeRedis(), mongo: fakeMongo(), env: 'staging', unblock, getConsumerStats: () => ({}), getRules: () => [] }));
  port = await listen(server);
});
after(() => server.close());

const json = { 'content-type': 'application/json' };

test('DELETE /api/blocks/:scope/:subject unblocks and returns the undo token', async () => {
  const { status, body } = await rawRequest(port, 'DELETE', `/api/blocks/auth/${H}`);
  assert.equal(status, 200);
  assert.deepEqual(body, { undoToken: TOKEN, undoExpiresAt: 1, removed: 2 });
  assert.deepEqual(calls.at(-1).slice(0, 3), ['unblock', 'auth', H]);
});

test('DELETE with nothing to unblock → 404; bad scope or a non-hash subject → 400 and never reaches the service', async () => {
  assert.equal((await rawRequest(port, 'DELETE', `/api/blocks/room_join/${'b'.repeat(16)}`)).status, 404);
  const before = calls.length;
  for (const path of [`/api/blocks/everything/${H}`, '/api/blocks/auth/172.18.0.5', '/api/blocks/auth/XK9PLM', `/api/blocks/socket/${H}`]) {
    const { status, body } = await rawRequest(port, 'DELETE', path);
    assert.equal(status, 400, path);
    assert.equal(body.error.code, 'INVALID_QUERY');
    assert.ok(!JSON.stringify(body).includes('172.18.0.5'), 'value not echoed');
  }
  assert.equal(calls.length, before, 'invalid input never reached the service');
});

test('POST /api/blocks/undo restores within the window; unknown or used token → 410 UNDO_EXPIRED', async () => {
  const ok = await rawRequest(port, 'POST', '/api/blocks/undo', { headers: json, body: JSON.stringify({ undoToken: TOKEN }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { restored: 2 });

  const gone = await rawRequest(port, 'POST', '/api/blocks/undo', { headers: json, body: JSON.stringify({ undoToken: 'c'.repeat(32) }) });
  assert.equal(gone.status, 410);
  assert.equal(gone.body.error.code, 'UNDO_EXPIRED');
});

test('POST /api/blocks/undo rejects malformed, extra-field and non-JSON bodies', async () => {
  for (const [headers, body] of [
    [json, JSON.stringify({ undoToken: 'short' })],
    [json, JSON.stringify({ undoToken: TOKEN, extra: 1 })],
    [json, '{not json'],
    [{ 'content-type': 'application/x-www-form-urlencoded' }, `undoToken=${TOKEN}`], // a cross-site form post
    [json, JSON.stringify({ undoToken: 'x'.repeat(2000) })], // over the 1 KB limit
  ]) {
    const { status } = await rawRequest(port, 'POST', '/api/blocks/undo', { headers, body });
    assert.ok(status === 400 || status === 413, `${body.slice(0, 30)} → ${status}`);
  }
});

test('cross-site mutations are refused before reaching the handler', async () => {
  const before = calls.length;
  const del = await rawRequest(port, 'DELETE', `/api/blocks/auth/${H}`, { headers: { origin: 'https://attacker.example' } });
  assert.equal(del.status, 403);
  const undo = await rawRequest(port, 'POST', '/api/blocks/undo', { headers: { ...json, origin: 'https://attacker.example' }, body: JSON.stringify({ undoToken: TOKEN }) });
  assert.equal(undo.status, 403);
  const rebound = await rawRequest(port, 'DELETE', `/api/blocks/auth/${H}`, { headers: { host: 'attacker.example:7070' } });
  assert.equal(rebound.status, 403);
  assert.equal(calls.length, before);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { toStreamFields } from 'kairo-schema';

import { createApp } from '../src/app.js';
import { fakeMongo, fakeRedis, listen, rawGet } from './apiFakes.js';

const event = (i) => ({
  ts: 1_760_800_000_000 + i,
  type: 'auth.fail',
  env: 'staging',
  inst: 'cypherfy-backend-1',
  src: { ipHash: '3e9a5b0c1d2e44c1', client: 'unknown', authed: false },
  auth: { route: 'login', status: 401, accountHash: `${i}`.padStart(16, 'a') },
});

const stream = [
  ...Array.from({ length: 30 }, (_, i) => [`1-${i}`, toStreamFields(event(i))]),
  ['1-30', ['v', '1', 'e', '{"not":"an event","email":"demo01@kairo.test"}']], // invalid: must be dropped
  ['1-31', ['v', '9', 'e', JSON.stringify(event(31))]], // unknown schema version: dropped
];

let server;
let port;
before(async () => {
  server = createServer(createApp({ redis: fakeRedis({ stream }), mongo: fakeMongo(), env: 'staging', getConsumerStats: () => ({}), getRules: () => [] }));
  port = await listen(server);
});
after(() => server.close());

test('GET /api/events/sample returns the newest valid events (default 20), dropping anything invalid', async () => {
  const { status, body } = await rawGet(port, '/api/events/sample');
  assert.equal(status, 200);
  // The 20 newest entries are 1-31 … 1-12; two of them are invalid, so 18 come back.
  assert.equal(body.items.length, 18);
  assert.equal(body.items[0].ts, event(29).ts, 'newest first');
  assert.ok(!JSON.stringify(body).includes('demo01@kairo.test'), 'the invalid entry never reaches the browser');
});

test('GET /api/events/sample?limit is validated (1–50)', async () => {
  assert.equal((await rawGet(port, '/api/events/sample?limit=5')).body.items.length, 3);
  for (const bad of ['0', '51', 'abc', '-1']) assert.equal((await rawGet(port, `/api/events/sample?limit=${bad}`)).status, 400, bad);
});

test('GET /api/schema returns the contract the Privacy screen renders', async () => {
  const { status, body } = await rawGet(port, '/api/schema');
  assert.equal(status, 200);
  assert.equal(body.schemaVersion, '1');
  assert.deepEqual(body.eventTypes, ['auth.fail', 'auth.success', 'room.join.invalid', 'http.denied']);
  assert.ok(body.received.some((f) => f.field === 'room.codeHash' && f.type === '16-hex HMAC hash'));
  assert.ok(body.neverReceived.some((n) => n.item === 'Raw room codes'));
  assert.match(body.scope, /CypherFy's own encryption model is documented separately/);
});

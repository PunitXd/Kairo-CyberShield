import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { createKnockService } from '../src/services/knock.service.js';
import { fakeMongo, listen, rawRequest } from './apiFakes.js';
import { fakeRedis } from './helpers.js';

const CODE = 'af47772dad981591';
let server;
let port;
let audits;
before(async () => {
  const clock = { now: Date.now() };
  const redis = fakeRedis(clock);
  await redis.set(`kairo:knock:${CODE}`, '{"until":1}', 'PX', 600_000);
  audits = [];
  const mongo = { ...fakeMongo(), auditLog: { insertOne: async (d) => audits.push(d) } };
  const knock = createKnockService({ redis, mongo, log: { error() {} }, hasher: null });
  server = createServer(createApp({ redis, mongo, env: 'staging', getConsumerStats: () => ({}), getRules: () => [], knock }));
  port = await listen(server);
});
after(() => server.close());

test('DELETE /api/knock/:codeHash lifts knock mode and audits it; a bad codeHash is 400', async () => {
  const ok = await rawRequest(port, 'DELETE', `/api/knock/${CODE}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.removed, 1);
  assert.equal(audits.at(-1).op, 'knock.lift');
  const gone = await rawRequest(port, 'DELETE', `/api/knock/${CODE}`);
  assert.equal(gone.body.removed, 0, 'already lifted');
  for (const bad of ['XK9PLM', '172.18.0.5', 'nothex']) {
    assert.equal((await rawRequest(port, 'DELETE', `/api/knock/${bad}`)).status, 400, bad);
  }
});

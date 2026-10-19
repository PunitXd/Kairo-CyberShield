import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { createKillSwitchService } from '../src/services/killswitch.service.js';
import { fakeMongo, listen, rawGet, rawRequest } from './apiFakes.js';
import { T0, fakeRedis } from './helpers.js';

const json = { 'content-type': 'application/json' };
let server;
let port;
const redis = fakeRedis({ now: T0 });
redis.ping = async () => 'PONG';

before(async () => {
  const killSwitch = createKillSwitchService({ redis, mongo: null, bus: null, now: () => T0 });
  server = createServer(createApp({ redis, mongo: fakeMongo(), env: 'staging', killSwitch, getConsumerStats: () => ({}), getRules: () => [] }));
  port = await listen(server);
});
after(() => server.close());

test('POST /api/killswitch turns it on and off; /api/health reports it with since', async () => {
  const on = await rawRequest(port, 'POST', '/api/killswitch', { headers: json, body: JSON.stringify({ on: true }) });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { on: true, since: T0, changed: true });
  const health = await rawGet(port, '/api/health');
  assert.equal(health.body.killSwitch, true);
  assert.equal(health.body.killSwitchSince, T0);

  const off = await rawRequest(port, 'POST', '/api/killswitch', { headers: json, body: JSON.stringify({ on: false }) });
  assert.deepEqual(off.body, { on: false, since: null, changed: true });
  assert.equal((await rawGet(port, '/api/health')).body.killSwitch, false);
});

test('POST /api/killswitch validates its body and refuses cross-site requests', async () => {
  for (const body of ['{"on":"yes"}', '{}', '{"on":true,"extra":1}', 'on=true']) {
    const { status } = await rawRequest(port, 'POST', '/api/killswitch', { headers: json, body });
    assert.equal(status, 400, body);
  }
  const cross = await rawRequest(port, 'POST', '/api/killswitch', { headers: { ...json, origin: 'https://attacker.example' }, body: JSON.stringify({ on: true }) });
  assert.equal(cross.status, 403);
  assert.equal(await redis.exists('kairo:killswitch'), 0, 'nothing changed');
});

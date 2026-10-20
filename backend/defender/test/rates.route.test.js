import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { getSystemStatus } from '../src/services/health.service.js';
import { fakeMongo, fakeRedis, listen, rawGet } from './apiFakes.js';

let server;
let port;
const samples = Array.from({ length: 5 }, (_, i) => ({ t: 1000 * i, counts: {}, total: 0, peaks: {} }));
before(async () => {
  const deps = { redis: fakeRedis(), mongo: fakeMongo(), env: 'staging', getConsumerStats: () => ({}), getRules: () => [], getRates: (w) => samples.slice(-w) };
  server = createServer(createApp(deps));
  port = await listen(server);
});
after(() => server.close());

test('GET /api/rates returns the history, default and limited window', async () => {
  const all = await rawGet(port, '/api/rates');
  assert.equal(all.status, 200);
  assert.equal(all.body.windowSec, 300);
  assert.equal(all.body.samples.length, 5);
  assert.equal((await rawGet(port, '/api/rates?windowSec=2')).body.samples.length, 2);
  for (const bad of ['windowSec=0', 'windowSec=301', 'windowSec=x', 'other=1']) {
    assert.equal((await rawGet(port, `/api/rates?${bad}`)).status, 400, bad);
  }
});

test('system status lists hooks instances: alive with a heartbeat, last event from either side', async () => {
  const redis = fakeRedis({
    keys: { 'kairo:hb:hooks:cypherfy-backend-1': { value: JSON.stringify({ at: 5000, lastEventAt: 4000 }), pttl: 20_000 } },
  });
  const status = await getSystemStatus({
    redis,
    mongo: fakeMongo(),
    env: 'staging',
    getConsumerStats: () => ({ lastEventAtByInst: { 'cypherfy-backend-1': 4500, 'old-instance': 100 } }),
    getRules: () => [],
  });
  assert.deepEqual(status.hooks, [
    { inst: 'cypherfy-backend-1', alive: true, heartbeatAt: 5000, lastEventAt: 4500 },
    { inst: 'old-instance', alive: false, heartbeatAt: null, lastEventAt: 100 },
  ]);
});

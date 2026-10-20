import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { DeployError } from '../src/services/deploy.service.js';
import { fakeMongo, listen, rawGet, rawRequest } from './apiFakes.js';

const TOKEN = 'x'.repeat(64);
const ID = '01JAA0000000000000000000AA';
const json = { 'content-type': 'application/json' };
const calls = [];
let server;
let port;

const deploys = {
  list: async () => ({ items: [], current: null, rollback: { frozen: false }, health: null }),
  create: async ({ tag }) => (calls.push(['create', tag]), { _id: ID, tag, prevTag: 'aaaaaaa' }),
  report: async (id, body) => {
    if (id !== ID) throw new DeployError(404, 'NOT_FOUND', 'Deployment not found');
    calls.push(['report', body]);
    return { status: 'deploying' };
  },
  manualRollback: async () => ({ requested: true, toTag: 'aaaaaaa' }),
  unfreeze: async () => ({ changed: true }),
};

before(async () => {
  server = createServer(createApp({ redis: { ping: async () => 'PONG' }, mongo: fakeMongo(), env: 'staging', deploys, deployToken: TOKEN, getConsumerStats: () => ({}), getRules: () => [] }));
  port = await listen(server);
});
after(() => server.close());

const post = (path, body, headers = {}) => rawRequest(port, 'POST', path, { headers: { ...json, ...headers }, body: JSON.stringify(body) });

test('deploy.sh and the deployer need the deploy token', async () => {
  assert.equal((await post('/api/deployments', { tag: 'abc1234' })).status, 401);
  assert.equal((await post('/api/deployments', { tag: 'abc1234' }, { 'x-kairo-deploy-token': 'wrong' })).status, 401);
  const ok = await post('/api/deployments', { tag: 'abc1234' }, { 'x-kairo-deploy-token': TOKEN });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body, { id: ID, tag: 'abc1234', prevTag: 'aaaaaaa' });
  assert.equal((await post(`/api/deployments/${ID}/status`, { op: 'deploy', state: 'started' })).status, 401);
  assert.equal((await post(`/api/deployments/${ID}/status`, { op: 'deploy', state: 'started' }, { 'x-kairo-deploy-token': TOKEN })).status, 200);
});

test('bodies are validated: SHA tags only, known states only', async () => {
  const h = { 'x-kairo-deploy-token': TOKEN };
  for (const body of [{ tag: 'latest' }, { tag: 'abc; rm -rf /' }, {}, { tag: 'abc1234', extra: 1 }]) {
    assert.equal((await post('/api/deployments', body, h)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post(`/api/deployments/${ID}/status`, { op: 'exec', state: 'started' }, h)).status, 400);
  assert.equal((await post('/api/deployments/01JAA0000000000000000000ZZ/status', { op: 'deploy', state: 'started' }, h)).status, 404);
  assert.ok(!calls.some(([, v]) => v === 'latest'));
});

test('operator routes: list, manual rollback, unfreeze; cross-site refused', async () => {
  assert.equal((await rawGet(port, '/api/deployments')).status, 200);
  assert.equal((await post(`/api/deployments/${ID}/rollback`, {})).status, 202);
  assert.deepEqual((await post('/api/rollback/unfreeze', {})).body, { changed: true });
  assert.equal((await post('/api/rollback/unfreeze', {}, { origin: 'https://attacker.example' })).status, 403);
});

test('without KAIRO_DEPLOY_TOKEN the script routes are off, not open', async () => {
  const s = createServer(createApp({ redis: { ping: async () => 'PONG' }, mongo: fakeMongo(), env: 'staging', deploys, deployToken: null, getConsumerStats: () => ({}), getRules: () => [] }));
  const p = await listen(s);
  const res = await rawRequest(p, 'POST', '/api/deployments', { headers: { ...json, 'x-kairo-deploy-token': '' }, body: '{"tag":"abc1234"}' });
  assert.equal(res.status, 503);
  s.close();
});

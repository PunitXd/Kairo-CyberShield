import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { createConfigStore } from '../src/defender.config.js';
import { createRuleService } from '../src/services/rule.service.js';
import { rules } from '../src/rules/index.js';
import { fakeMongo, listen, rawGet, rawRequest } from './apiFakes.js';
import { T0 } from './helpers.js';

const json = { 'content-type': 'application/json' };
const quiet = { info() {}, warn() {}, error() {} };
let server;
let port;
let configStore;

before(async () => {
  configStore = createConfigStore(fileURLToPath(new URL('../config/rules.json', import.meta.url)), quiet);
  const mongo = { ...fakeMongo(), incidents: { aggregate: () => ({ toArray: async () => [] }) } };
  const redis = { get: async () => null, zcount: async () => 0, scan: async () => ['0', []], ping: async () => 'PONG' };
  const ruleService = createRuleService({ configStore, rules, mongo, redis, log: quiet, now: () => T0 });
  await ruleService.init();
  server = createServer(createApp({ redis, mongo, env: 'staging', log: quiet, ruleService, getConsumerStats: () => ({}), getRules: () => [] }));
  port = await listen(server);
});
after(() => server.close());

test('GET /api/rules lists every rule with its mode and the config version', async () => {
  const { status, body } = await rawGet(port, '/api/rules');
  assert.equal(status, 200);
  assert.equal(body.items.length, rules.length);
  assert.equal(body.configVersion, configStore.get().version);
  assert.equal(body.items.find((r) => r.id === 'R1b').mode, 'enforce');
});

test('PATCH /api/rules/:id switches a mode and back; the version goes up each time', async () => {
  const v0 = configStore.get().version;
  const off = await rawRequest(port, 'PATCH', '/api/rules/R1b', { headers: json, body: JSON.stringify({ mode: 'shadow' }) });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { configVersion: v0 + 1, rule: { id: 'R1b', mode: 'shadow' }, changed: true });
  const on = await rawRequest(port, 'PATCH', '/api/rules/R1b', { headers: json, body: JSON.stringify({ mode: 'enforce' }) });
  assert.equal(on.body.configVersion, v0 + 2);
  assert.equal(configStore.get().rules.R1b.mode, 'enforce');
});

test('PATCH /api/rules validates, 404s unknown rules, refuses disallowed modes and cross-site requests', async () => {
  const v = configStore.get().version;
  for (const body of ['{"mode":"loud"}', '{}', '{"mode":"shadow","threshold":1}', 'mode=shadow']) {
    assert.equal((await rawRequest(port, 'PATCH', '/api/rules/R1a', { headers: json, body })).status, 400, body);
  }
  assert.equal((await rawRequest(port, 'PATCH', '/api/rules/R9z', { headers: json, body: '{"mode":"off"}' })).status, 404);
  assert.equal((await rawRequest(port, 'PATCH', '/api/rules/..%2Fx', { headers: json, body: '{"mode":"off"}' })).status, 400);
  const r1c = await rawRequest(port, 'PATCH', '/api/rules/R1c', { headers: json, body: '{"mode":"enforce"}' });
  assert.equal(r1c.status, 400);
  assert.equal(r1c.body.error.code, 'MODE_NOT_ALLOWED');
  const cross = await rawRequest(port, 'PATCH', '/api/rules/R1a', { headers: { ...json, origin: 'https://attacker.example' }, body: '{"mode":"off"}' });
  assert.equal(cross.status, 403);
  assert.equal(configStore.get().version, v, 'nothing changed');
  assert.equal(configStore.get().rules.R1a.mode, 'enforce');
});

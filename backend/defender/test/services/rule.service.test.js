import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { createConfigStore } from '../../src/defender.config.js';
import { createRuleService, RuleNotFoundError } from '../../src/services/rule.service.js';
import { rules } from '../../src/rules/index.js';
import { T0 } from '../helpers.js';

const RULES_PATH = fileURLToPath(new URL('../../config/rules.json', import.meta.url));
const quiet = { info() {}, warn() {}, error() {} };

const fakeVersions = (docs = []) => ({
  docs,
  find: () => ({
    sort: () => ({ limit: (n) => ({ toArray: async () => [...docs].sort((a, b) => b.version - a.version).slice(0, n) }) }),
  }),
  insertOne: async (d) => docs.push(d),
});

const setup = ({ snapshots = [], incidents = [], redisKeys = {} } = {}) => {
  const configStore = createConfigStore(RULES_PATH, quiet);
  const audit = [];
  const mongo = {
    configVersions: fakeVersions(snapshots),
    auditLog: { insertOne: async (d) => audit.push(d) },
    incidents: { aggregate: (pipeline) => ({ toArray: async () => aggregate(incidents, pipeline) }) },
  };
  const redis = {
    get: async (k) => redisKeys[k] ?? null,
    zcount: async () => 3,
    scan: async (_c, _m, pattern) => ['0', Object.keys(redisKeys).filter((k) => k.startsWith(pattern.replace('*', '')))],
  };
  const bus = new EventEmitter();
  const pushed = [];
  bus.on('config.updated', (p) => pushed.push(p));
  const service = createRuleService({ configStore, rules, mongo, redis, bus, log: quiet, now: () => T0 });
  return { configStore, service, mongo, audit, pushed };
};

// Just enough of the $unwind/$group pipeline used by list().
const aggregate = (incidents, [{ $match }]) => {
  const out = new Map();
  for (const inc of incidents.filter((i) => i.detectedAt >= $match.detectedAt.$gte)) {
    for (const id of inc.rulesFired) {
      const row = out.get(id) ?? { _id: id, fired: 0, falsePositives: 0 };
      row.fired += 1;
      row.falsePositives += inc.falsePositive ? 1 : 0;
      out.set(id, row);
    }
  }
  return [...out.values()];
};

test('boot with no history snapshots rules.json at its own version', async () => {
  const { service, configStore, mongo } = setup();
  const fileVersion = configStore.get().version;
  assert.equal(await service.init(), fileVersion);
  assert.equal(mongo.configVersions.docs.length, 1);
  assert.equal(mongo.configVersions.docs[0].actor, 'rules.json');
});

test('boot continues after the newest snapshot, so versions never repeat', async () => {
  const { configStore } = setup();
  const file = configStore.get();
  const changed = { version: file.version + 2, global: file.global, rules: { ...file.rules, R1b: { ...file.rules.R1b, mode: 'shadow' } } };
  const a = setup({ snapshots: [changed] });
  assert.equal(await a.service.init(), file.version + 3, 'file differs from the last snapshot: next number');
  assert.equal(a.configStore.get().rules.R1b.mode, 'enforce', 'the file wins after a restart');

  const same = { version: file.version + 2, global: file.global, rules: file.rules };
  const b = setup({ snapshots: [same] });
  assert.equal(await b.service.init(), file.version + 2, 'identical content keeps that version');
  assert.equal(b.mongo.configVersions.docs.length, 1, 'no duplicate snapshot');
});

test('setMode: changes the live mode, bumps the version, snapshots, audits and pushes config.updated', async () => {
  const { service, configStore, mongo, audit, pushed } = setup();
  const v0 = await service.init();
  const r = await service.setMode('R1b', 'shadow', { actorIp: '127.0.0.1' });
  assert.deepEqual(r, { configVersion: v0 + 1, rule: { id: 'R1b', mode: 'shadow' }, changed: true });
  assert.equal(configStore.get().rules.R1b.mode, 'shadow');
  assert.equal(configStore.get().rules.R1b.threshold, 10, 'thresholds untouched');
  assert.equal(mongo.configVersions.docs.at(-1).version, v0 + 1);
  assert.equal(mongo.configVersions.docs.at(-1).actor, 'operator');
  assert.deepEqual(audit[0].before, { mode: 'enforce', configVersion: v0 });
  assert.deepEqual(audit[0].after, { mode: 'shadow', configVersion: v0 + 1 });
  assert.equal(audit[0].op, 'rule_mode');
  assert.deepEqual(pushed, [{ configVersion: v0 + 1 }]);

  const same = await service.setMode('R1b', 'shadow');
  assert.equal(same.changed, false);
  assert.equal(same.configVersion, v0 + 1, 'no-op keeps the version');
});

test('setMode refuses unknown rules and modes a rule does not allow (R1c is shadow/off only)', async () => {
  const { service, configStore } = setup();
  await service.init();
  await assert.rejects(service.setMode('R9z', 'shadow'), RuleNotFoundError);
  await assert.rejects(service.setMode('R1c', 'enforce'));
  assert.equal(configStore.get().rules.R1c.mode, 'shadow', 'nothing changed');
});

test('list: config, allowed modes, 7-day counts and the safety numbers', async () => {
  const day = 24 * 3600_000;
  const { service } = setup({
    incidents: [
      { detectedAt: new Date(T0 - day), rulesFired: ['R1a', 'R1b'], falsePositive: true },
      { detectedAt: new Date(T0 - 2 * day), rulesFired: ['R1a'], falsePositive: false },
      { detectedAt: new Date(T0 - 9 * day), rulesFired: ['R2a'], falsePositive: false },
    ],
    redisKeys: { 'kairo:killswitch': JSON.stringify({ at: T0 - 5000 }), 'kairo:allow:aaaaaaaaaaaaaaaa': '1' },
  });
  await service.init();
  const out = await service.list();
  const byId = Object.fromEntries(out.items.map((r) => [r.id, r]));
  assert.equal(out.items.length, rules.length);
  assert.deepEqual([byId.R1a.fired7d, byId.R1a.falsePositives7d], [2, 1]);
  assert.deepEqual([byId.R1b.fired7d, byId.R1b.falsePositives7d], [1, 1]);
  assert.equal(byId.R2a.fired7d, 0, 'older than 7 days');
  assert.deepEqual(byId.R1c.allowedModes, ['shadow', 'off']);
  assert.deepEqual(byId.R1a.allowedModes, ['enforce', 'shadow', 'off']);
  assert.equal(byId.R1a.threshold, 5);
  assert.equal(byId.R1a.params.ttlMs, 300_000);
  assert.equal(byId.R1a.params.mode, undefined);
  assert.equal(byId.R1a.name, 'Brute-force login (soft)');
  assert.deepEqual(out.safety, { killSwitch: true, killSwitchSince: T0 - 5000, activeBlocks: 3, activeBlockCap: 50, allowlisted: 1 });
});

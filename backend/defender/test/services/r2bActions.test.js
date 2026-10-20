import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRemediation } from '../../src/services/remediation.service.js';
import { rules } from '../../src/rules/index.js';
import { IP_A, T0, fakeRedis, silentLog, withRules } from '../helpers.js';

const CODE = 'af47772dad981591';
const r2a = rules.find((r) => r.id === 'R2a');
const r2b = rules.find((r) => r.id === 'R2b');
const cfg = withRules({ R2b: { mode: 'enforce' } });

const memoryMongo = () => {
  const incidents = new Map();
  return {
    actions: { insertMany: async () => ({}) },
    incidents: { findOne: async ({ _id }) => incidents.get(_id) ?? null, updateOne: async ({ _id }, u) => incidents.set(_id, { _id, ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) }) },
  };
};

const run = async (rule, decision) => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  const bus = new EventEmitter();
  const added = [];
  bus.on('block.added', (b) => added.push(b));
  const remediation = createRemediation({ redis, mongo: memoryMongo(), env: 'staging', log: silentLog, bus, now: () => clock.now });
  const out = await remediation.handle({ rule, subject: IP_A, decision, event: { ts: T0 - 5, src: { ipHash: IP_A } }, ruleCfg: cfg.rules[rule.id], config: cfg, rules });
  return { redis, added, out };
};

test('R2a flag: the flag key is set (10 min) but never shows as a block in the rail', async () => {
  const decision = {
    severity: 'medium', summary: 's',
    actions: [{ type: 'block', scope: 'room_join' }, { type: 'flag', scope: 'room_guess', ttlMs: 600_000 }],
    evidence: { observed: 8, threshold: 8, windowMs: 60_000 }, fieldsUsed: [],
  };
  const { redis, added, out } = await run(r2a, decision);
  assert.equal(await redis.get(`kairo:flag:roomguess:${IP_A}`) !== null, true, 'flag set');
  assert.equal(await redis.pttl(`kairo:flag:roomguess:${IP_A}`), 600_000);
  assert.deepEqual(out.actions.map((a) => [a.type, a.result]), [['block', 'applied'], ['flag', 'applied']]);
  assert.deepEqual(added.map((b) => b.level), ['block'], 'only the block reaches the rail, not the flag');
  assert.equal(await redis.zcard('kairo:blocks:active'), 1, 'the flag does not count toward the active-block cap');
});

test('R2b knock_mode: the knock key is set on the room, and is not a source block', async () => {
  const decision = {
    severity: 'critical', summary: 's',
    actions: [{ type: 'knock_mode', scope: 'room', ttlMs: 600_000, params: { codeHash: CODE } }],
    evidence: { observed: 1, codeHash: CODE }, fieldsUsed: [],
  };
  const { redis, added, out } = await run(r2b, decision);
  const raw = await redis.get(`kairo:knock:${CODE}`);
  assert.ok(raw, 'knock key set on the room');
  assert.equal(JSON.parse(raw).until, T0 + 600_000);
  assert.equal(out.actions[0].result, 'applied');
  assert.deepEqual(added, [], 'knock mode is not a source block');
  assert.equal(await redis.zcard('kairo:blocks:active'), 0);
});

test('R2b in shadow records but sets no knock key', async () => {
  const shadow = withRules({ R2b: { mode: 'shadow' } });
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  const remediation = createRemediation({ redis, mongo: memoryMongo(), env: 'staging', log: silentLog, now: () => clock.now });
  const out = await remediation.handle({
    rule: r2b, subject: IP_A,
    decision: { severity: 'critical', summary: 's', actions: [{ type: 'knock_mode', scope: 'room', ttlMs: 600_000, params: { codeHash: CODE } }], evidence: {}, fieldsUsed: [] },
    event: { ts: T0, src: { ipHash: IP_A } }, ruleCfg: shadow.rules.R2b, config: shadow, rules,
  });
  assert.equal(out.actions[0].result, 'skipped_shadow');
  assert.equal(await redis.get(`kairo:knock:${CODE}`), null);
});

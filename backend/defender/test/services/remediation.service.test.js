import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRemediation } from '../../src/services/remediation.service.js';
import { rules } from '../../src/rules/index.js';
import { CONFIG, IP_A, T0, authFail, fakeRedis, silentLog } from '../helpers.js';

const [r1a] = rules;

/** Minimal Mongo: remembers incidents written with updateOne(upsert) so findOne returns them. */
const fakeMongo = () => {
  const incidents = new Map();
  return {
    actions: { insertMany: async () => ({}) },
    incidents: {
      findOne: async ({ _id }) => incidents.get(_id) ?? null,
      updateOne: async ({ _id }, update) => {
        incidents.set(_id, { _id, ...(update.$setOnInsert ?? {}), ...(update.$set ?? {}) });
      },
    },
  };
};

test('the console hears block.added and action.applied before incident.created, so a row never flashes the wrong state', async () => {
  const clock = { now: T0 };
  const bus = new EventEmitter();
  const order = [];
  for (const name of ['block.added', 'action.applied', 'incident.created', 'incident.updated']) {
    bus.on(name, (payload) => order.push([name, payload.level ?? payload.result ?? payload.ruleId]));
  }
  const remediation = createRemediation({ redis: fakeRedis(clock), mongo: fakeMongo(), env: 'staging', log: silentLog, bus, now: () => clock.now });

  await remediation.handle({
    rule: r1a,
    subject: IP_A,
    decision: { severity: 'medium', summary: 's', actions: [{ type: 'throttle', scope: 'auth', ttlMs: 300_000 }], evidence: { observed: 5, threshold: 5, windowMs: 60_000 }, fieldsUsed: [] },
    event: authFail({ ts: clock.now - 10 }),
    ruleCfg: CONFIG.rules.R1a,
    config: CONFIG,
    rules,
  });

  assert.deepEqual(order, [
    ['block.added', 'throttle'],
    ['action.applied', 'applied'],
    ['incident.created', 'R1a'],
  ]);
});

test('skipped actions publish action.applied but no block.added', async () => {
  const clock = { now: T0 };
  const bus = new EventEmitter();
  const names = [];
  for (const name of ['block.added', 'action.applied', 'incident.created']) bus.on(name, () => names.push(name));
  const remediation = createRemediation({ redis: fakeRedis(clock), mongo: fakeMongo(), env: 'production', log: silentLog, bus, now: () => clock.now });
  await remediation.handle({
    rule: r1a,
    subject: IP_A,
    decision: { severity: 'medium', summary: 's', actions: [{ type: 'throttle', scope: 'auth', ttlMs: 300_000 }], evidence: { observed: 5, threshold: 5, windowMs: 60_000 }, fieldsUsed: [] },
    event: authFail({ ts: clock.now - 10 }),
    ruleCfg: CONFIG.rules.R1a,
    config: CONFIG,
    rules,
  });
  assert.deepEqual(names, ['action.applied', 'incident.created'], 'production = shadow: nothing enforced, nothing on the rail');
});

test('with the kill switch on, a new incident is recorded as Shadow and nothing is enforced', async () => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  await redis.set('kairo:killswitch', '{"by":"operator"}');
  const mongo = fakeMongo();
  const bus = new EventEmitter();
  const seen = [];
  bus.on('incident.created', (i) => seen.push(i.status));
  bus.on('block.added', () => seen.push('block.added'));
  const remediation = createRemediation({ redis, mongo, env: 'staging', log: silentLog, bus, now: () => clock.now });
  const out = await remediation.handle({
    rule: r1a,
    subject: IP_A,
    decision: { severity: 'medium', summary: 's', actions: [{ type: 'throttle', scope: 'auth', ttlMs: 300_000 }], evidence: { observed: 5, threshold: 5, windowMs: 60_000 }, fieldsUsed: [] },
    event: authFail({ ts: clock.now - 10 }),
    ruleCfg: CONFIG.rules.R1a,
    config: CONFIG,
    rules,
  });
  assert.equal(out.actions[0].result, 'skipped_killswitch');
  assert.deepEqual(seen, ['shadow'], 'incident is Shadow, and nothing reaches the rail');
  assert.equal(await redis.exists(`kairo:throttle:auth:${IP_A}`), 0);
});

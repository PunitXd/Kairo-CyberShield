// Socket actions are commands to the hooks: published on kairo:commands,
// `sent` until kairo.ack arrives, then `applied` with TTR to the ack.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRemediation } from '../../src/services/remediation.service.js';
import { createAckService } from '../../src/services/ack.service.js';
import { rules } from '../../src/rules/index.js';
import { IP_A, T0, fakeRedis, silentLog, socketRate, withRules } from '../helpers.js';

const r3b = rules.find((r) => r.id === 'R3b');
const r3a = rules.find((r) => r.id === 'R3a');
const enforce = withRules({ R3a: { mode: 'enforce' }, R3b: { mode: 'enforce' } });

const memoryMongo = () => {
  const actions = new Map();
  const incidents = new Map();
  return {
    actions: {
      store: actions,
      insertMany: async (docs) => docs.forEach((d) => actions.set(d._id, structuredClone(d))),
      findOne: async ({ _id }) => structuredClone(actions.get(_id) ?? null),
      updateOne: async ({ _id, result }, { $set }) => {
        const doc = actions.get(_id);
        if (!doc || (result && doc.result !== result)) return { modifiedCount: 0 };
        Object.assign(doc, $set);
        return { modifiedCount: 1 };
      },
    },
    incidents: {
      findOne: async ({ _id }) => incidents.get(_id) ?? null,
      updateOne: async ({ _id }, u) => incidents.set(_id, { _id, ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) }),
    },
  };
};

const hardDecision = {
  severity: 'high',
  summary: '120 socket events in 10 s from one connection',
  actions: [
    { type: 'disconnect', scope: 'socket', params: { socketId: 'sockA' } },
    { type: 'block', scope: 'socket' },
  ],
  evidence: { observed: 120, threshold: 100, windowMs: 10_000 },
  fieldsUsed: [],
};

const run = async ({ config = enforce, decision = hardDecision, rule = r3b } = {}) => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  const mongo = memoryMongo();
  const bus = new EventEmitter();
  const remediation = createRemediation({ redis, mongo, env: 'staging', log: silentLog, bus, now: () => clock.now });
  const event = socketRate({ ts: clock.now - 40, counts: { send_message: 120 } });
  const out = await remediation.handle({ rule, subject: IP_A, decision, event, ruleCfg: config.rules[rule.id], config, rules });
  return { redis, mongo, bus, clock, out, event };
};

test('R3b in enforce: disconnect is published and `sent`; the socket block is a ladder key; no strike for the disconnect', async () => {
  const { redis, out } = await run();
  const [disconnect, block] = out.actions;
  assert.equal(disconnect.result, 'sent');
  assert.equal(disconnect.appliedAt, null, 'not applied until the hooks ack');
  assert.equal(disconnect.ttlMs, null);
  assert.equal(disconnect.strike, null, 'a disconnect never burns a ladder strike');
  assert.equal(disconnect.socketId, 'sockA');
  assert.deepEqual(redis.published, [['kairo:commands', { v: 1, actionId: disconnect._id, op: 'disconnect_socket', socketId: 'sockA' }]]);
  assert.equal(block.result, 'applied');
  assert.equal(block.strike, 1, 'the block takes the first ladder step');
  assert.equal(block.ttlMs, 300_000);
  assert.ok(await redis.get(`kairo:block:socket:${IP_A}`));
});

test('R3a in enforce: throttle_socket carries the configured rate and duration', async () => {
  const decision = {
    severity: 'low',
    summary: 's',
    actions: [{ type: 'throttle', scope: 'socket', ttlMs: 10_000, params: { socketId: 'sockA', maxPerSec: 3 } }],
    evidence: { observed: 30, threshold: 30, windowMs: 10_000 },
    fieldsUsed: [],
  };
  const { redis, out } = await run({ decision, rule: r3a });
  assert.equal(out.actions[0].result, 'sent');
  assert.equal(out.actions[0].strike, null, 'a fixed TTL, not the ladder');
  assert.deepEqual(redis.published[0][1], { v: 1, actionId: out.actions[0]._id, op: 'throttle_socket', socketId: 'sockA', maxPerSec: 3, ttlMs: 10_000 });
  assert.equal(await redis.get(`kairo:throttle:socket:${IP_A}`), null, 'no Redis key: the bucket lives in the hooks');
});

test('shadow mode publishes nothing', async () => {
  const { redis, out } = await run({ config: withRules({ R3a: { mode: 'shadow' }, R3b: { mode: 'shadow' } }) });
  assert.deepEqual(out.actions.map((a) => a.result), ['skipped_shadow', 'skipped_shadow']);
  assert.deepEqual(redis.published, []);
});

test('kairo.ack turns `sent` into `applied` with TTR measured to the ack; a second ack is a no-op', async () => {
  const { mongo, bus, out, event } = await run();
  const id = out.actions[0]._id;
  const applied = [];
  bus.on('action.applied', (a) => applied.push(a));
  const acks = createAckService({ mongo, bus, log: silentLog });
  const ack = { ts: event.ts + 900, type: 'kairo.ack', env: 'staging', inst: 'test-1', src: event.src, ack: { actionId: id, ok: true } };

  await acks.handle(ack);
  const doc = mongo.actions.store.get(id);
  assert.equal(doc.result, 'applied');
  assert.equal(doc.latencyMs, 900, 'trigger event → hooks disconnected the socket');
  assert.equal(doc.ackedAt.getTime(), event.ts + 900);
  assert.equal(applied.length, 1);

  await acks.handle({ ...ack, ts: ack.ts + 5000 });
  assert.equal(mongo.actions.store.get(id).latencyMs, 900);
  assert.equal(applied.length, 1);
});

test('an ack with ok:false marks the action failed; unknown action ids are ignored', async () => {
  const { mongo, out, event } = await run();
  const acks = createAckService({ mongo, log: silentLog });
  await acks.handle({ ts: event.ts + 100, type: 'kairo.ack', src: event.src, ack: { actionId: out.actions[0]._id, ok: false } });
  assert.equal(mongo.actions.store.get(out.actions[0]._id).result, 'failed');
  await acks.handle({ ts: event.ts, type: 'kairo.ack', src: event.src, ack: { actionId: '01JAB3K5Q8ZP4M2N7R9T1V6W0X', ok: true } });
});

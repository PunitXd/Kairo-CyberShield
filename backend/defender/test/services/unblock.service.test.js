import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createHasher } from 'kairo-schema';

import { createUnblockService, UNDO_WINDOW_MS } from '../../src/services/unblock.service.js';
import { IP_A, T0, fakeRedis, silentLog } from '../helpers.js';

const hasher = createHasher('fixture'.repeat(6));
const INC = '01JAB00000000000000000INC1';
const KEY = {
  block: `kairo:block:auth:${IP_A}`,
  throttle: `kairo:throttle:auth:${IP_A}`,
  gate: `kairo:tb:auth:${IP_A}`,
  open: `kairo:inc:open:auth:${IP_A}`,
};

/** Mongo fake with just the calls the unblock service makes. */
const fakeMongo = () => {
  const incidents = new Map([[INC, { _id: INC, status: 'open', closedAt: null, ruleId: 'R1b' }]]);
  const actions = new Map([
    ['a1', { _id: 'a1' }],
    ['a2', { _id: 'a2' }],
  ]);
  const audit = [];
  const applyUpdate = (doc, u) => {
    Object.assign(doc, u.$set ?? {});
    for (const k of Object.keys(u.$unset ?? {})) delete doc[k];
  };
  return {
    incidentsMap: incidents,
    actionsMap: actions,
    audit,
    incidents: {
      find: ({ _id }) => ({ toArray: async () => [...incidents.values()].filter((d) => _id.$in.includes(d._id)).map((d) => ({ ...d })) }),
      findOne: async ({ _id }) => incidents.get(_id) ?? null,
      updateMany: async ({ _id }, u) => [...incidents.values()].filter((d) => _id.$in.includes(d._id)).forEach((d) => applyUpdate(d, u)),
      updateOne: async ({ _id }, u) => incidents.has(_id) && applyUpdate(incidents.get(_id), u),
    },
    actions: { updateMany: async ({ _id }, u) => [...actions.values()].filter((d) => _id.$in.includes(d._id)).forEach((d) => applyUpdate(d, u)) },
    auditLog: { insertOne: async (doc) => audit.push(doc) },
  };
};

const setup = async () => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  const mongo = fakeMongo();
  const bus = new EventEmitter();
  const events = [];
  for (const name of ['block.added', 'block.removed', 'incident.updated']) bus.on(name, (p) => events.push([name, p.level ?? p.status, p.ttlMs]));
  await redis.set(KEY.block, JSON.stringify({ actionId: 'a2', rule: 'R1b', incidentId: INC }), 'PX', 300_000);
  await redis.set(KEY.throttle, JSON.stringify({ actionId: 'a1', rule: 'R1a', incidentId: INC }), 'PX', 120_000);
  await redis.set(KEY.gate, '1', 'PX', 5000);
  await redis.set(KEY.open, INC, 'PX', 4_200_000);
  await redis.zadd('kairo:blocks:active', T0 + 300_000, `auth:${IP_A}`);
  const svc = createUnblockService({ redis, mongo, bus, log: silentLog, hasher, now: () => clock.now });
  return { clock, redis, mongo, events, svc };
};

test('unblock deletes every enforcement key, closes the incident, audits, and publishes', async () => {
  const { redis, mongo, events, svc } = await setup();
  const out = await svc.unblock('auth', IP_A, { actorIp: '::ffff:192.168.65.1' });

  assert.match(out.undoToken, /^[0-9a-f]{32}$/);
  assert.equal(out.undoExpiresAt, T0 + UNDO_WINDOW_MS);
  assert.equal(out.removed, 2);
  for (const k of Object.values(KEY)) assert.equal(await redis.exists(k), 0, `${k} deleted`);
  assert.equal(await redis.zcard('kairo:blocks:active'), 0);

  assert.equal(mongo.incidentsMap.get(INC).status, 'manually_resolved');
  assert.ok(mongo.incidentsMap.get(INC).closedAt instanceof Date);
  assert.equal(mongo.actionsMap.get('a2').liftedBy, 'operator');

  assert.equal(mongo.audit.length, 1);
  const [entry] = mongo.audit;
  assert.equal(entry.op, 'unblock');
  assert.deepEqual(entry.target, { scope: 'auth', subject: IP_A });
  assert.equal(entry.actorIpHash, hasher.ip('192.168.65.1'), 'operator IP is hashed');
  assert.ok(!JSON.stringify(entry).includes('192.168'), 'raw operator IP is never stored');

  assert.deepEqual(events.map((e) => e.slice(0, 2)), [
    ['block.removed', 'block'],
    ['block.removed', 'throttle'],
    ['incident.updated', 'manually_resolved'],
  ]);
});

test('unblock returns null when nothing is active (→ 404)', async () => {
  const { redis, svc } = await setup();
  await redis.del(KEY.block, KEY.throttle);
  assert.equal(await svc.unblock('auth', IP_A), null);
});

test('undo within 10 s restores every key with its REMAINING TTL, reopens the incident, and is single-use', async () => {
  const { clock, redis, mongo, events, svc } = await setup();
  const { undoToken } = await svc.unblock('auth', IP_A);
  events.length = 0;
  clock.now += 4000; // operator clicks Undo 4 s later

  assert.deepEqual(await svc.undo(undoToken), { restored: 2 });
  assert.equal(await redis.pttl(KEY.block), 296_000, 'not reset to 5 min: 4 s were used up');
  assert.equal(await redis.pttl(KEY.throttle), 116_000);
  assert.equal(await redis.get(KEY.open), INC);
  assert.equal(await redis.zcard('kairo:blocks:active'), 1);
  assert.equal(await redis.exists(KEY.gate), 0, 'the 5 s token gate is not worth restoring');

  assert.equal(mongo.incidentsMap.get(INC).status, 'open');
  assert.equal(mongo.actionsMap.get('a2').liftedAt, undefined);
  assert.deepEqual(mongo.audit.map((a) => a.op), ['unblock', 'undo_unblock']);
  assert.deepEqual(events.map((e) => e.slice(0, 2)), [
    ['block.added', 'block'],
    ['block.added', 'throttle'],
    ['incident.updated', 'open'],
  ]);

  assert.equal(await svc.undo(undoToken), null, 'a token works once');
});

test('undo after the 10 s window restores nothing (→ 410)', async () => {
  const { clock, redis, svc } = await setup();
  const { undoToken } = await svc.unblock('auth', IP_A);
  clock.now += UNDO_WINDOW_MS + 1;
  assert.equal(await svc.undo(undoToken), null);
  assert.equal(await redis.exists(KEY.block), 0);
});

test('undo never clobbers a newer key, and skips keys that would have expired by now', async () => {
  const { clock, redis, svc } = await setup();
  await redis.set(KEY.throttle, JSON.stringify({ rule: 'R1a', incidentId: INC }), 'PX', 3000); // about to expire
  const { undoToken } = await svc.unblock('auth', IP_A);
  clock.now += 5000; // the throttle's 3 s would have run out
  await redis.set(KEY.block, JSON.stringify({ rule: 'R1b', incidentId: 'NEW' }), 'PX', 900_000); // re-trip meanwhile

  assert.deepEqual(await svc.undo(undoToken), { restored: 1 });
  assert.equal(JSON.parse(await redis.get(KEY.block)).incidentId, 'NEW', 'newer block kept');
  assert.equal(await redis.pttl(KEY.block), 900_000);
  assert.equal(await redis.exists(KEY.throttle), 0, 'expired throttle not resurrected');
});

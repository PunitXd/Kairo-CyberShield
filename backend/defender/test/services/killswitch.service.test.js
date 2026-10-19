import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createHasher } from 'kairo-schema';

import { createKillSwitchService } from '../../src/services/killswitch.service.js';
import { T0, fakeRedis, silentLog } from '../helpers.js';

const hasher = createHasher('fixture'.repeat(6));

const setup = () => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  const audit = [];
  const bus = new EventEmitter();
  let changes = 0;
  bus.on('system.changed', () => changes++);
  const svc = createKillSwitchService({ redis, mongo: { auditLog: { insertOne: async (d) => audit.push(d) } }, bus, log: silentLog, hasher, now: () => clock.now });
  return { clock, redis, audit, svc, changes: () => changes };
};

test('turning it on sets kairo:killswitch with NO expiry, audits with a hashed IP, and pushes status', async () => {
  const { redis, audit, svc, changes } = setup();
  assert.deepEqual(await svc.set(true, { actorIp: '::ffff:192.168.65.1' }), { on: true, since: T0, changed: true });
  assert.equal(await redis.pttl('kairo:killswitch'), -1, 'manual only: no TTL');
  assert.deepEqual(JSON.parse(await redis.get('kairo:killswitch')), { by: 'operator', at: T0 });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].op, 'killswitch_on');
  assert.equal(audit[0].actorIpHash, hasher.ip('192.168.65.1'));
  assert.ok(!JSON.stringify(audit[0]).includes('192.168'));
  assert.equal(changes(), 1);
});

test('turning it off deletes the key and audits; repeating a state is a no-op', async () => {
  const { clock, redis, audit, svc, changes } = setup();
  await svc.set(true);
  assert.equal((await svc.set(true)).changed, false, 'already on');
  clock.now += 60_000;
  assert.deepEqual(await svc.set(false), { on: false, since: null, changed: true });
  assert.equal(await redis.exists('kairo:killswitch'), 0);
  assert.deepEqual(audit.map((a) => a.op), ['killswitch_on', 'killswitch_off']);
  assert.equal((await svc.set(false)).changed, false, 'already off');
  assert.equal(changes(), 2, 'no pushes for no-ops');
});

test('get() reports the state and since', async () => {
  const { svc } = setup();
  assert.deepEqual(await svc.get(), { on: false, since: null });
  await svc.set(true);
  assert.deepEqual(await svc.get(), { on: true, since: T0 });
});

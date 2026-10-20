import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createDeployService, DeployError } from '../../src/services/deploy.service.js';
import { probeOnce } from '../../src/pollers/health.poller.js';
import { r4BadDeploy } from '../../src/rules/r4BadDeploy.rule.js';
import { CONFIG } from '../helpers.js';

const T0 = 1_792_600_000_000;
const quiet = { info() {}, warn() {}, error() {} };
const R4 = { mode: 'enforce', probeEveryMs: 10_000, probeTimeoutMs: 3000, failuresInARow: 3, graceMs: 60_000, watchMs: 600_000, budgetMs: 1_800_000, ackTimeoutMs: 15_000, recoverMs: 90_000 };

// ---- in-memory fakes: just the operations deploy.service uses ----
const matches = (doc, filter) =>
  Object.entries(filter).every(([k, c]) => {
    const v = doc[k];
    if (c && typeof c === 'object' && !(c instanceof Date) && '$gte' in c) return v != null && v >= c.$gte;
    return v === c;
  });
const collection = () => {
  const docs = [];
  const apply = (doc, u) => {
    Object.assign(doc, u.$set ?? {});
    for (const [k, v] of Object.entries(u.$addToSet ?? {})) {
      const add = v?.$each ?? [v];
      doc[k] = [...new Set([...(doc[k] ?? []), ...add])];
    }
    for (const [k, v] of Object.entries(u.$push ?? {})) {
      const arr = [...(doc[k] ?? []), ...(v.$each ?? [v])];
      doc[k] = v.$slice ? arr.slice(v.$slice) : arr;
    }
  };
  return {
    docs,
    insertOne: async (d) => docs.push(structuredClone(d)),
    findOne: async (f) => structuredClone(docs.find((d) => matches(d, f)) ?? null),
    find: (f = {}) => {
      let rows = docs.filter((d) => matches(d, f));
      const cur = {
        sort: (spec) => {
          const [[k, dir]] = Object.entries(spec);
          rows = [...rows].sort((a, b) => (a[k] < b[k] ? -dir : a[k] > b[k] ? dir : 0));
          return cur;
        },
        limit: (n) => ((rows = rows.slice(0, n)), cur),
        toArray: async () => structuredClone(rows),
      };
      return cur;
    },
    updateOne: async (f, u, opts = {}) => {
      let doc = docs.find((d) => matches(d, f));
      if (!doc && opts.upsert) {
        doc = { ...f, ...(u.$setOnInsert ?? {}) };
        docs.push(doc);
      }
      if (!doc) return { modifiedCount: 0 };
      apply(doc, u);
      return { modifiedCount: 1 };
    },
  };
};
const fakeRedis = (clock) => {
  const kv = new Map();
  const live = (k) => {
    const e = kv.get(k);
    if (e?.exp && e.exp <= clock.now) kv.delete(k);
    return kv.get(k);
  };
  return {
    kv,
    published: [],
    get: async (k) => live(k)?.v ?? null,
    set: async (k, v, ...opts) => {
      const nx = opts.includes('NX');
      const px = opts.includes('PX') ? opts[opts.indexOf('PX') + 1] : null;
      if (nx && live(k)) return null;
      kv.set(k, { v, exp: px ? clock.now + px : null });
      return 'OK';
    },
    del: async (k) => (kv.delete(k) ? 1 : 0),
    pttl: async (k) => (live(k) ? (live(k).exp ? live(k).exp - clock.now : -1) : -2),
  };
};

const setup = ({ mode = 'enforce', env = 'staging' } = {}) => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  redis.publish = async (ch, msg) => redis.published.push([ch, JSON.parse(msg)]);
  const mongo = { deployments: collection(), incidents: collection(), actions: collection(), auditLog: collection() };
  const bus = new EventEmitter();
  const events = [];
  for (const e of ['deployment.updated', 'incident.created', 'incident.updated', 'action.applied', 'system.changed']) bus.on(e, (p) => events.push([e, p]));
  const timers = [];
  const fakeTimers = {
    setTimeout: (fn, ms) => {
      const t = { fn, at: clock.now + ms, done: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => t && (t.done = true),
  };
  const config = { ...CONFIG, rules: { ...CONFIG.rules, R4: { ...R4, mode } } };
  const svc = createDeployService({ redis, mongo, bus, log: quiet, env, getConfig: () => config, rule: r4BadDeploy, now: () => clock.now, timers: fakeTimers });
  const advance = async (ms) => {
    clock.now += ms;
    for (const t of timers.filter((x) => !x.done && x.at <= clock.now)) {
      t.done = true;
      await t.fn();
    }
    await new Promise((r) => setImmediate(r));
  };
  const probe = (ok, extra = {}) => svc.onProbe({ at: clock.now, ok, httpStatus: ok ? 200 : 500, status: ok ? 'ok' : 'error', ...extra });
  return { clock, redis, mongo, events, svc, advance, probe };
};

const TAG_GOOD = 'aaaaaaa1111';
const TAG_BAD = 'bbbbbbb2222';

/** A deployment that went healthy: create → started → grace → OK probe. */
const healthyDeploy = async (t, tag = TAG_GOOD) => {
  const d = await t.svc.create({ tag });
  await t.svc.report(d._id, { op: 'deploy', state: 'accepted' });
  await t.svc.report(d._id, { op: 'deploy', state: 'started' });
  await t.advance(61_000);
  await t.probe(true);
  return d;
};

/** A bad deploy that fails 3 probes after the grace window. */
const badDeploy = async (t) => {
  const d = await t.svc.create({ tag: TAG_BAD });
  await t.svc.report(d._id, { op: 'deploy', state: 'accepted' });
  await t.svc.report(d._id, { op: 'deploy', state: 'started' });
  for (let i = 0; i < 5; i++) {
    await t.advance(10_000);
    await t.probe(false); // +10 … +50 s: inside the 60 s grace window, ignored
  }
  for (let i = 0; i < 3; i++) {
    await t.advance(10_000);
    await t.probe(false);
  }
  return d;
};

test('a deploy is published to the deployer, waits out the grace window, then turns healthy', async () => {
  const t = setup();
  const d = await t.svc.create({ tag: TAG_GOOD });
  assert.deepEqual(t.redis.published[0], ['kairo:deploy:commands', { v: 1, op: 'deploy', tag: TAG_GOOD, deploymentId: d._id }]);
  assert.equal(d.prevTag, null);
  await t.svc.report(d._id, { op: 'deploy', state: 'started' });
  await t.advance(20_000);
  await t.probe(false); // a restart is briefly unhealthy: in the grace window, ignored
  await t.probe(true); // still in grace: not healthy yet
  assert.equal((await t.mongo.deployments.findOne({ _id: d._id })).status, 'deploying');
  await t.advance(45_000);
  await t.probe(true);
  const doc = await t.mongo.deployments.findOne({ _id: d._id });
  assert.equal(doc.status, 'healthy');
  assert.equal(doc.probeLog.length, 3);
  const listed = await t.svc.list();
  assert.equal(listed.current.tag, TAG_GOOD);
  assert.deepEqual(listed.config, { mode: 'enforce', graceMs: 60_000, probeEveryMs: 10_000, failuresInARow: 3, budgetMs: 1_800_000, recoverMs: 90_000 });
  // The next deploy rolls back to this one.
  const next = await t.svc.create({ tag: TAG_BAD });
  assert.equal(next.prevTag, TAG_GOOD);
});

test('R4: 3 failed probes after grace → rollback published (sent), applied on the deployer ack, rolled_back once healthy', async () => {
  const t = setup();
  await healthyDeploy(t);
  const bad = await badDeploy(t);
  const rollback = t.redis.published.find(([, m]) => m.op === 'rollback')[1];
  assert.equal(rollback.tag, TAG_GOOD);
  assert.equal(rollback.deploymentId, bad._id);
  assert.equal((await t.mongo.deployments.findOne({ _id: bad._id })).status, 'unhealthy');
  let action = await t.mongo.actions.findOne({ _id: rollback.actionId });
  assert.equal(action.result, 'sent');
  assert.ok(await t.redis.get('kairo:rollback:budget'), 'budget taken');

  await t.svc.report(bad._id, { op: 'rollback', state: 'accepted', actionId: rollback.actionId });
  await t.advance(5000);
  await t.svc.report(bad._id, { op: 'rollback', state: 'started', actionId: rollback.actionId });
  action = await t.mongo.actions.findOne({ _id: rollback.actionId });
  assert.equal(action.result, 'applied');
  assert.equal(action.latencyMs, 5000, 'TTR: last failed probe → rollback running');
  await t.advance(10_000);
  await t.probe(true);
  const doc = await t.mongo.deployments.findOne({ _id: bad._id });
  assert.equal(doc.status, 'rolled_back');
  assert.equal(doc.rolledBackTo, TAG_GOOD);
  const incident = await t.mongo.incidents.findOne({ _id: doc.incidentId });
  assert.equal(incident.ruleId, 'R4');
  assert.equal(incident.subjectKind, 'deploy');
  assert.equal(incident.severity, 'high');
  assert.match(incident.summary, /Rolled back to aaaaaaa; healthy again in 10 s\./);
  assert.ok(incident.rolledBackAt);
  await t.advance(20_000);
  assert.equal((await t.mongo.actions.findOne({ _id: rollback.actionId })).result, 'applied', 'the ack timer was cleared');
});

test('budget: a second bad deploy within 30 min is not rolled back; automation freezes; critical incident', async () => {
  const t = setup();
  await healthyDeploy(t);
  const first = await badDeploy(t);
  const rb = t.redis.published.find(([, m]) => m.op === 'rollback')[1];
  await t.svc.report(first._id, { op: 'rollback', state: 'started', actionId: rb.actionId });
  await t.probe(true);

  const second = await badDeploy(t);
  assert.equal(t.redis.published.filter(([, m]) => m.op === 'rollback').length, 1, 'no second rollback');
  const doc = await t.mongo.deployments.findOne({ _id: second._id });
  const incident = await t.mongo.incidents.findOne({ _id: doc.incidentId });
  assert.equal(incident.severity, 'critical');
  assert.match(incident.summary, /^Rollback paused/);
  const [action] = t.mongo.actions.docs.filter((a) => a.deploymentId === second._id);
  assert.equal(action.result, 'skipped_budget');
  assert.equal((await t.svc.rollbackState()).frozen, true);
  assert.ok((await t.svc.rollbackState()).budgetAvailableAt > t.clock.now);
});

test('deployer not running: no ack within 15 s → action failed, frozen, critical incident (ARCH §13)', async () => {
  const t = setup();
  await healthyDeploy(t);
  const bad = await badDeploy(t);
  const rb = t.redis.published.find(([, m]) => m.op === 'rollback')[1];
  await t.advance(14_000);
  assert.equal((await t.mongo.actions.findOne({ _id: rb.actionId })).result, 'sent');
  await t.advance(2000);
  const action = await t.mongo.actions.findOne({ _id: rb.actionId });
  assert.equal(action.result, 'failed');
  assert.match(action.error, /did not answer within 15 s/);
  const doc = await t.mongo.deployments.findOne({ _id: bad._id });
  const incident = await t.mongo.incidents.findOne({ _id: doc.incidentId });
  assert.equal(incident.severity, 'critical');
  assert.match(incident.summary, /^Rollback failed/);
  assert.equal((await t.svc.rollbackState()).frozen, true);
});

test('the previous version is unhealthy too: no recovery within 90 s → frozen, critical', async () => {
  const t = setup();
  await healthyDeploy(t);
  const bad = await badDeploy(t);
  const rb = t.redis.published.find(([, m]) => m.op === 'rollback')[1];
  await t.svc.report(bad._id, { op: 'rollback', state: 'started', actionId: rb.actionId });
  for (let i = 0; i < 10; i++) {
    await t.advance(10_000);
    await t.probe(false);
  }
  const doc = await t.mongo.deployments.findOne({ _id: bad._id });
  assert.notEqual(doc.status, 'rolled_back');
  const incident = await t.mongo.incidents.findOne({ _id: doc.incidentId });
  assert.match(incident.summary, /previous version \(aaaaaaa\) is also unhealthy/);
  assert.equal((await t.svc.rollbackState()).frozenReason, 'previous version also unhealthy');
});

test('no healthy version to roll back to → failed + frozen; shadow mode only records', async () => {
  const t = setup();
  await badDeploy(t); // first ever deploy: nothing healthy before it
  assert.equal(t.mongo.actions.docs[0].result, 'failed');
  assert.equal(t.mongo.actions.docs[0].error, 'no healthy version to roll back to');
  assert.equal((await t.svc.rollbackState()).frozen, true);

  const s = setup({ mode: 'shadow' });
  await healthyDeploy(s);
  await badDeploy(s);
  assert.equal(s.redis.published.filter(([, m]) => m.op === 'rollback').length, 0);
  assert.equal(s.mongo.actions.docs[0].result, 'skipped_shadow');
  assert.equal(s.mongo.incidents.docs[0].status, 'shadow');
  assert.equal(await s.redis.get('kairo:rollback:budget'), null, 'shadow never burns the budget');
});

test('a deploy the deployer never acknowledges fails after 15 s; tags and concurrency are checked', async () => {
  const t = setup();
  const d = await t.svc.create({ tag: TAG_GOOD });
  await assert.rejects(t.svc.create({ tag: TAG_BAD }), (e) => e instanceof DeployError && e.code === 'DEPLOY_IN_PROGRESS');
  await t.advance(15_000);
  const doc = await t.mongo.deployments.findOne({ _id: d._id });
  assert.equal(doc.status, 'failed');
  assert.match(doc.error, /deployer did not answer/);
  await assert.rejects(t.svc.create({ tag: 'latest; rm -rf /' }), (e) => e.code === 'INVALID_TAG');
  await assert.rejects(t.svc.report('01JAA0000000000000000000ZZ', { op: 'deploy', state: 'started' }), (e) => e.statusCode === 404);
});

test('unfreeze clears the freeze (audited); the budget key still applies', async () => {
  const t = setup();
  await badDeploy(t);
  assert.equal((await t.svc.rollbackState()).frozen, true);
  assert.deepEqual(await t.svc.unfreeze({ actorIp: '127.0.0.1' }), { changed: true });
  assert.equal((await t.svc.rollbackState()).frozen, false);
  assert.equal(t.mongo.auditLog.docs[0].op, 'rollback_unfreeze');
  assert.deepEqual(await t.svc.unfreeze(), { changed: false });
});

test('probeOnce: OK only for 200 + {"status":"ok"}; 500, degraded, timeout and refusal fail', async () => {
  const res = (status, body) => async () => ({ status, text: async () => body });
  assert.equal((await probeOnce({ url: 'x', timeoutMs: 100, fetchImpl: res(200, '{"status":"ok","mongo":"connected"}') })).ok, true);
  assert.equal((await probeOnce({ url: 'x', timeoutMs: 100, fetchImpl: res(200, '{"status":"degraded"}') })).ok, false);
  const bad = await probeOnce({ url: 'x', timeoutMs: 100, fetchImpl: res(500, '{"status":"error"}') });
  assert.deepEqual([bad.ok, bad.httpStatus, bad.status], [false, 500, 'error']);
  const timeout = await probeOnce({ url: 'x', timeoutMs: 100, fetchImpl: async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })) });
  assert.equal(timeout.error, 'timeout');
  const refused = await probeOnce({ url: 'x', timeoutMs: 100, fetchImpl: async () => Promise.reject(new TypeError('fetch failed')) });
  assert.equal(refused.error, 'unreachable');
});

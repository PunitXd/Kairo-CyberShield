// Deployments and R4 auto-rollback (ARCH §4.5, §7.3, §11.4, §13; PRD F11).
//
//   create({tag})        deploy.sh asked for a deploy: record it, publish
//                        {op:'deploy'} on kairo:deploy:commands for the host
//                        deployer, and expect its ack within ackTimeoutMs.
//   report(id, state)    the deployer: accepted → started | failed.
//   onProbe(result)      every health probe (pollers/health.poller.js):
//                        • watched deployment: failures in the grace window
//                          after "started" don't count; the first OK probe
//                          after it marks the deployment healthy; R4 decides
//                          when it has failed → trigger the rollback.
//                        • rollback in progress: the first OK probe marks the
//                          bad deployment rolled_back; none within recoverMs
//                          means the previous version is unhealthy too.
//
// The rollback runs these safeguards in order (ARCH §7.2 + R4's loop guards):
// env ≠ staging → shadow; kill switch; rule in shadow; automation frozen;
// no healthy deployment to go back to (→ freeze); budget key
// `SET kairo:rollback:budget NX PX budgetMs` already taken (→ freeze). Only
// then is {op:'rollback'} published. The action is `sent` until the deployer
// reports `started` (→ applied); no ack in ackTimeoutMs → failed, critical,
// frozen (ARCH §13 "Deployer not running"). Every outcome is an incident and
// action in Mongo, like the event rules, and is pushed to the console.

import { ulid } from 'ulid';

import { DEPLOY_KEYS, DEPLOY_TAG_RE, KEYS } from '../defender.constant.js';

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const PROBE_LOG_MAX = 20;
const REQUEST_STALE_MS = 10 * 60_000; // a deploy never started after this long doesn't block new ones

export class DeployError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const parse = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export const createDeployService = ({
  redis,
  mongo,
  bus = null,
  log,
  env,
  getConfig,
  rule,
  hasher = null,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
}) => {
  const deployments = mongo.deployments;
  const cfg = () => getConfig().rules.R4;
  let watch = null; // { id, tag, prevTag, prevId, startedAt, failuresInARow, lastProbe }
  let recovery = null; // { id, toTag, since, actionId }
  let lastProbe = null;
  const acks = new Map(); // `${id}:${op}` → timer

  const safe = (what, fn) =>
    Promise.resolve()
      .then(fn)
      .catch((err) => log?.error({ msg: 'deploy.error', what, error: err?.message?.slice(0, 200) }));

  const emitDeployment = async (id) => {
    const doc = await deployments.findOne({ _id: id });
    if (doc) bus?.emit('deployment.updated', doc);
    return doc;
  };
  const setDeployment = async (id, set) => {
    await deployments.updateOne({ _id: id }, { $set: set });
    return emitDeployment(id);
  };

  const publish = (command) => redis.publish(DEPLOY_KEYS.commands, JSON.stringify({ v: 1, ...command }));

  const armAck = (id, op, onTimeout) => {
    const key = `${id}:${op}`;
    if (acks.has(key)) timers.clearTimeout(acks.get(key));
    const timer = timers.setTimeout(() => {
      acks.delete(key);
      safe(`ack_timeout.${op}`, onTimeout);
    }, cfg().ackTimeoutMs);
    timer?.unref?.();
    acks.set(key, timer);
  };
  const clearAck = (id, op) => {
    const key = `${id}:${op}`;
    if (acks.has(key)) timers.clearTimeout(acks.get(key));
    return acks.delete(key);
  };

  const audit = (op, { actorIp, target, before = null, after = null }) =>
    safe('audit_log', () =>
      mongo.auditLog?.insertOne({
        _id: ulid(),
        at: new Date(now()),
        actor: 'operator',
        actorIpHash: actorIp && hasher ? hasher.ip(actorIp) : null,
        op,
        target,
        before,
        after,
      })
    );

  const freeze = async (reason) => {
    await redis.set(DEPLOY_KEYS.frozen, JSON.stringify({ reason, at: now() }));
    log?.error({ msg: 'rollback.frozen', reason });
    bus?.emit('system.changed');
  };

  /** One incident per deployment (family deploy, subject = image tag); severity only goes up. */
  const writeIncident = async (dep, { severity, summary, evidence, fieldsUsed, triggerTs, actionIds = [], status = 'open', taken = [] }) => {
    const incidentId = dep.incidentId ?? ulid();
    const current = dep.incidentId ? await mongo.incidents.findOne({ _id: incidentId }, { projection: { severity: 1, status: 1 } }) : null;
    const config = getConfig();
    const sev = current && SEVERITY_RANK[current.severity] > SEVERITY_RANK[severity] ? current.severity : severity;
    await mongo.incidents.updateOne(
      { _id: incidentId },
      {
        $setOnInsert: {
          family: 'deploy',
          subject: dep.tag,
          subjectKind: 'deploy',
          deploymentId: dep._id,
          firstEventTs: triggerTs,
          detectedAt: new Date(now()),
          closedAt: null,
          falsePositive: false,
          env,
        },
        $set: {
          ruleId: rule.id,
          ruleVersion: rule.version,
          configVersion: config.version,
          severity: sev,
          status: current?.status === 'open' ? 'open' : status,
          summary,
          ...(evidence ? { evidence } : {}),
          ...(fieldsUsed ? { fieldsUsed } : {}),
          triggerEventTs: triggerTs,
          lastSeenAt: new Date(now()),
        },
        $addToSet: { rulesFired: rule.id, ...(taken.length ? { actionsTaken: { $each: taken } } : {}) },
        ...(actionIds.length ? { $push: { actionIds: { $each: actionIds } } } : {}),
      },
      { upsert: true }
    );
    if (!dep.incidentId) {
      await deployments.updateOne({ _id: dep._id }, { $set: { incidentId } });
      dep.incidentId = incidentId;
    }
    const incident = await mongo.incidents.findOne({ _id: incidentId });
    if (incident) bus?.emit(current ? 'incident.updated' : 'incident.created', incident);
    return incidentId;
  };

  const isHealthy = async (id) => Boolean(id && (await deployments.findOne({ _id: id, status: 'healthy' })));

  /** R4 fired: run the safeguards, then roll back (or explain why not). */
  const trigger = async (dep, decision, triggerTs) => {
    const c = cfg();
    if (c.mode === 'off') return;
    const actionId = ulid();
    const requestedAt = now();
    let result = null;
    let error;
    let critical = null;

    if (env !== 'staging') result = 'skipped_shadow';
    else if (await redis.get(KEYS.killswitch)) result = 'skipped_killswitch';
    else if (c.mode === 'shadow') result = 'skipped_shadow';
    else if (await redis.get(DEPLOY_KEYS.frozen)) {
      result = 'skipped_frozen';
      critical = 'Rollback paused: automation is frozen until an operator clears it. Manual action needed.';
    } else if (!dep.prevTag || !(await isHealthy(dep.prevId))) {
      result = 'failed';
      error = 'no healthy version to roll back to';
      critical = 'Rollback paused: there is no healthy version to roll back to. Manual action needed.';
      await freeze(error);
    } else if ((await redis.set(DEPLOY_KEYS.budget, JSON.stringify({ at: requestedAt, deploymentId: dep._id }), 'PX', c.budgetMs, 'NX')) !== 'OK') {
      result = 'skipped_budget';
      critical = 'Rollback paused: the one automatic rollback for this window was already used. Manual action needed.';
      await freeze('rollback budget used');
    } else {
      await publish({ op: 'rollback', tag: dep.prevTag, deploymentId: dep._id, actionId });
      result = 'sent';
      armAck(dep._id, 'rollback', () => rollbackFailed(dep, actionId, `the deployer did not answer within ${Math.round(c.ackTimeoutMs / 1000)} s`));
    }

    const action = {
      _id: actionId,
      incidentId: null,
      ruleId: rule.id,
      type: 'rollback',
      scope: 'deploy',
      subject: dep.tag,
      mode: c.mode,
      result,
      requestedAt: new Date(requestedAt),
      appliedAt: null,
      expiresAt: null,
      ttlMs: null,
      strike: null,
      toTag: dep.prevTag ?? null,
      deploymentId: dep._id,
      summary: decision.summary,
      triggerEventTs: triggerTs,
      ttdMs: requestedAt - triggerTs,
      latencyMs: null,
      ...(error ? { error } : {}),
    };
    const shadow = result === 'skipped_shadow' || result === 'skipped_killswitch';
    const incidentId = await writeIncident(dep, {
      severity: critical ? 'critical' : decision.severity,
      summary: critical ? `${critical} ${decision.summary}` : decision.summary,
      evidence: decision.evidence,
      fieldsUsed: decision.fieldsUsed,
      triggerTs,
      actionIds: [actionId],
      status: shadow ? 'shadow' : 'open',
      taken: result === 'sent' ? ['rollback'] : [],
    });
    action.incidentId = incidentId;
    await mongo.actions.insertOne(action);
    log?.info({ msg: 'action', incidentId, actionId, rule: rule.id, action: 'rollback', scope: 'deploy', subject: `deploy:${dep.tag}`, toTag: dep.prevTag, mode: c.mode, result, ttdMs: action.ttdMs });
    bus?.emit('action.applied', action);
  };

  const rollbackFailed = async (dep, actionId, error) => {
    const res = await mongo.actions.updateOne({ _id: actionId, result: 'sent' }, { $set: { result: 'failed', error } });
    if (!res.modifiedCount) return;
    if (recovery?.actionId === actionId) recovery = null;
    await freeze(`rollback failed: ${error}`);
    const doc = await deployments.findOne({ _id: dep._id });
    await writeIncident(doc ?? dep, { severity: 'critical', summary: `Rollback failed: ${error}. Automation is frozen; manual action needed.`, triggerTs: now() });
    bus?.emit('action.applied', await mongo.actions.findOne({ _id: actionId }));
  };

  const probeEntry = (p) => ({ at: new Date(p.at), ok: p.ok, httpStatus: p.httpStatus ?? null, status: p.status ?? null, error: p.error ?? null, ms: p.ms ?? null });

  return {
    /** deploy.sh → a new deployment; publishes {op:'deploy'} for the host deployer. */
    async create({ tag }) {
      if (!DEPLOY_TAG_RE.test(String(tag))) throw new DeployError(400, 'INVALID_TAG', 'tag must be a git SHA (7–40 hex)');
      const busy = watch || recovery || (await deployments.findOne({ status: 'deploying', requestedAt: { $gte: new Date(now() - REQUEST_STALE_MS) } }));
      if (busy) throw new DeployError(409, 'DEPLOY_IN_PROGRESS', 'another deploy or rollback is still in progress');
      const [prev] = await deployments.find({ status: 'healthy' }).sort({ healthyAt: -1 }).limit(1).toArray();
      const doc = {
        _id: ulid(),
        tag,
        prevTag: prev?.tag ?? null,
        prevId: prev?._id ?? null,
        env,
        status: 'deploying',
        requestedAt: new Date(now()),
        startedAt: null,
        healthyAt: null,
        rolledBackAt: null,
        rolledBackTo: null,
        incidentId: null,
        probeLog: [],
      };
      await deployments.insertOne(doc);
      await publish({ op: 'deploy', tag, deploymentId: doc._id });
      armAck(doc._id, 'deploy', () =>
        setDeployment(doc._id, { status: 'failed', error: `the deployer did not answer within ${Math.round(cfg().ackTimeoutMs / 1000)} s (is scripts/deployer.js running?)` })
      );
      log?.info({ msg: 'deploy.requested', deploymentId: doc._id, tag, prevTag: doc.prevTag });
      bus?.emit('deployment.updated', doc);
      return doc;
    },

    /** deployer.js → accepted | started | failed, for op deploy or rollback. */
    async report(id, { state, op, actionId = null, error = null }) {
      const dep = await deployments.findOne({ _id: id });
      if (!dep) throw new DeployError(404, 'NOT_FOUND', 'Deployment not found');
      clearAck(id, op);
      if (state === 'accepted') return dep;
      const at = now();

      if (op === 'deploy') {
        if (state === 'started') {
          watch = { id, tag: dep.tag, prevTag: dep.prevTag, prevId: dep.prevId, startedAt: at, failuresInARow: 0, lastProbe: null };
          log?.info({ msg: 'deploy.started', deploymentId: id, tag: dep.tag });
          return setDeployment(id, { status: 'deploying', startedAt: new Date(at) });
        }
        if (watch?.id === id) watch = null;
        return setDeployment(id, { status: 'failed', error: error ?? 'the deployer could not start it' });
      }

      // op === 'rollback'
      if (state === 'started') {
        recovery = { id, toTag: dep.prevTag, since: at, actionId };
        if (actionId) {
          const action = await mongo.actions.findOne({ _id: actionId });
          if (action?.result === 'sent') {
            const update = { result: 'applied', appliedAt: new Date(at), latencyMs: Math.max(0, at - action.triggerEventTs) };
            await mongo.actions.updateOne({ _id: actionId, result: 'sent' }, { $set: update });
            log?.info({ msg: 'action.acked', actionId, rule: 'R4', action: 'rollback', result: 'applied', ttrMs: update.latencyMs });
            bus?.emit('action.applied', { ...action, ...update });
          }
        }
        return emitDeployment(id);
      }
      if (actionId) await rollbackFailed(dep, actionId, error ?? 'the deployer could not run it');
      return emitDeployment(id);
    },

    /** One health probe result: { at, ok, httpStatus?, status?, error?, ms? }. */
    async onProbe(p) {
      lastProbe = p;
      if (watch) {
        const w = watch;
        w.lastProbe = p;
        const c = cfg();
        const inGrace = p.at - w.startedAt < c.graceMs;
        await deployments.updateOne({ _id: w.id }, { $push: { probeLog: { $each: [probeEntry(p)], $slice: -PROBE_LOG_MAX } } });
        if (p.ok) {
          w.failuresInARow = 0;
          if (!inGrace) {
            watch = null;
            log?.info({ msg: 'deploy.healthy', deploymentId: w.id, tag: w.tag });
            await setDeployment(w.id, { status: 'healthy', healthyAt: new Date(p.at) });
          } else await emitDeployment(w.id);
        } else if (!inGrace) {
          w.failuresInARow += 1;
          const decision = rule.evaluateProbe(w, c, p.at);
          if (decision) {
            watch = null;
            const dep = await setDeployment(w.id, { status: 'unhealthy', unhealthyAt: new Date(p.at) });
            await trigger(dep, decision, p.at);
          } else await emitDeployment(w.id);
        } else await emitDeployment(w.id);
        if (watch === w && p.at - w.startedAt > c.watchMs) watch = null; // watched long enough
      }

      if (recovery) {
        const r = recovery;
        await deployments.updateOne({ _id: r.id }, { $push: { probeLog: { $each: [probeEntry(p)], $slice: -PROBE_LOG_MAX } } });
        if (p.ok) {
          recovery = null;
          const recoveredMs = p.at - r.since;
          log?.info({ msg: 'rollback.recovered', deploymentId: r.id, toTag: r.toTag, recoveredMs });
          const dep = await setDeployment(r.id, { status: 'rolled_back', rolledBackAt: new Date(p.at), rolledBackTo: r.toTag, recoveredMs });
          if (dep?.incidentId) {
            await mongo.incidents.updateOne({ _id: dep.incidentId }, { $set: { rolledBackAt: new Date(p.at), rolledBackTo: r.toTag } });
            const inc = await mongo.incidents.findOne({ _id: dep.incidentId });
            if (inc) {
              await writeIncident(dep, {
                severity: inc.severity,
                summary: `${inc.summary.replace(/\s*Rolled back to .*$/, '')} Rolled back to ${r.toTag.slice(0, 7)}; healthy again in ${Math.round(recoveredMs / 1000)} s.`,
                triggerTs: inc.triggerEventTs,
              });
            }
          }
        } else if (p.at - r.since > cfg().recoverMs) {
          recovery = null;
          await freeze('previous version also unhealthy');
          const dep = await setDeployment(r.id, { status: 'unhealthy', rollbackFailedAt: new Date(p.at) });
          await writeIncident(dep, {
            severity: 'critical',
            summary: `Rollback paused: the previous version (${r.toTag.slice(0, 7)}) is also unhealthy. Manual action needed.`,
            triggerTs: p.at,
          });
        }
      }
    },

    /** Operator: roll this deployment back to its previous healthy version (no budget used). */
    async manualRollback(id, { actorIp } = {}) {
      const dep = await deployments.findOne({ _id: id });
      if (!dep) throw new DeployError(404, 'NOT_FOUND', 'Deployment not found');
      if (recovery) throw new DeployError(409, 'ROLLBACK_IN_PROGRESS', 'a rollback is already in progress');
      if (!(await isHealthy(dep.prevId))) throw new DeployError(409, 'NO_HEALTHY_TARGET', 'the previous version was never marked healthy');
      if (watch?.id === id) watch = null;
      await publish({ op: 'rollback', tag: dep.prevTag, deploymentId: id, actionId: null });
      armAck(id, 'rollback', () => setDeployment(id, { rollbackError: 'the deployer did not answer (is scripts/deployer.js running?)' }));
      await audit('rollback_manual', { actorIp, target: { deploymentId: id, tag: dep.tag }, after: { toTag: dep.prevTag } });
      log?.warn({ msg: 'operator.rollback_manual', deploymentId: id, tag: dep.tag, toTag: dep.prevTag });
      return { requested: true, toTag: dep.prevTag };
    },

    /** Operator: clear the freeze so R4 may act again (the budget key still applies). */
    async unfreeze({ actorIp } = {}) {
      const raw = await redis.get(DEPLOY_KEYS.frozen);
      if (!raw) return { changed: false };
      await redis.del(DEPLOY_KEYS.frozen);
      await audit('rollback_unfreeze', { actorIp, target: { rollback: true }, before: parse(raw), after: { frozen: false } });
      log?.warn({ msg: 'operator.rollback_unfreeze' });
      bus?.emit('system.changed');
      return { changed: true };
    },

    /** Frozen / budget state, for system.status and the Deployments screen. */
    async rollbackState() {
      const [frozen, budgetTtl] = await Promise.all([redis.get(DEPLOY_KEYS.frozen), redis.pttl(DEPLOY_KEYS.budget)]);
      const f = frozen ? parse(frozen) : null;
      return {
        frozen: Boolean(frozen),
        frozenReason: f?.reason ?? null,
        frozenAt: f?.at ?? null,
        budgetAvailableAt: budgetTtl > 0 ? now() + budgetTtl : null,
      };
    },

    /** GET /api/deployments: newest first, the version serving now, and the rollback state. */
    async list({ limit = 20 } = {}) {
      const items = await deployments.find({}).sort({ requestedAt: -1 }).limit(limit).toArray();
      const serving = items.find((d) => d.status !== 'failed');
      const current = serving
        ? { tag: serving.status === 'rolled_back' ? serving.rolledBackTo : serving.tag, deploymentId: serving._id, status: serving.status === 'rolled_back' ? 'healthy' : serving.status }
        : null;
      const c = cfg();
      return {
        items,
        current,
        rollback: await this.rollbackState(),
        health: lastProbe,
        watching: watch?.id ?? null,
        recovering: recovery?.id ?? null,
        // R4 timing, so the screen can draw the grace bar and the budget line without guessing.
        config: { mode: c.mode, graceMs: c.graceMs, probeEveryMs: c.probeEveryMs, failuresInARow: c.failuresInARow, budgetMs: c.budgetMs, recoverMs: c.recoverMs },
      };
    },

    /** Boot: resume watching a deployment that was mid-grace when the Defender restarted. */
    async resume() {
      const [dep] = await deployments.find({ status: 'deploying', startedAt: { $gte: new Date(now() - cfg().watchMs) } }).sort({ startedAt: -1 }).limit(1).toArray();
      if (dep) watch = { id: dep._id, tag: dep.tag, prevTag: dep.prevTag, prevId: dep.prevId, startedAt: dep.startedAt.getTime(), failuresInARow: 0, lastProbe: null };
      return dep?._id ?? null;
    },

    lastProbe: () => lastProbe,
    stop: () => {
      for (const t of acks.values()) timers.clearTimeout(t);
      acks.clear();
    },
  };
};

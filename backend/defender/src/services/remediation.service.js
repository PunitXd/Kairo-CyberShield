// Remediation pipeline every rule decision goes through (ARCH §7.2):
//
//   1. Incident: one open incident per (family, subject), found through
//      kairo:inc:open:{family}:{subject}; severity only ever goes up, so the
//      R1 incident updates in place from medium (throttle) to high (block).
//   2. Per action: safeguards in order, then the TTL (fixed or ladder; none
//      for a disconnect, which must never burn a ladder strike).
//   3. Apply through Redis FIRST, then record in Mongo, so a Mongo outage
//      never delays or prevents protection. One `action` log line each (§14.1).
//      Socket actions are commands to the hooks: `sent` here, `applied` when
//      the hooks' kairo.ack arrives (ack.service.js).
//   4. Publish to the in-process bus for the console (ARCH §9.3):
//      incident.created/updated, action.applied, block.added.
//
// Every outcome is recorded as an action, including skips.

import { ulid } from 'ulid';

import { FP_STORM_KEY, KEYS } from '../defender.constant.js';
import { checkSafeguards, computeTtl } from './safeguard.service.js';
import { toBlockItem } from './block.service.js';
import { blockAction } from '../actions/block.action.js';
import { throttleAction } from '../actions/throttle.action.js';
import { disconnectAction } from '../actions/disconnect.action.js';
import { socketThrottleAction } from '../actions/socketThrottle.action.js';

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const ENFORCED = new Set(['applied', 'already_active']);
const FP_STORM_TTL_MS = 10 * 60_000;

export const defaultHandlers = { throttle: throttleAction, block: blockAction, disconnect: disconnectAction, socketThrottle: socketThrottleAction };

// A socket-scope throttle is a token bucket in the hooks, not a Redis key.
const handlerFor = (handlers, request) =>
  request.type === 'throttle' && request.scope === 'socket' ? handlers.socketThrottle : handlers[request.type];

const maxSeverity = (a, b) => ((SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a);

export const createRemediation = ({ redis, mongo, env, log, bus = null, now = Date.now, handlers = defaultHandlers }) => {
  const writeMongo = async (what, fn) => {
    if (!mongo) return;
    try {
      await fn();
    } catch (err) {
      log.error({ msg: 'mongo.write_failed', what, error: err?.message?.slice(0, 200) });
    }
  };

  // Longest window in the family plus the longest ladder step (ARCH §7.2 step 1).
  const openIncidentTtl = (config, family, rules) => {
    const windows = rules.filter((r) => r.family === family).map((r) => config.rules[r.id]?.windowMs ?? 0);
    return Math.max(0, ...windows) + Math.max(...config.global.ladderMs);
  };

  const findOrOpenIncident = async ({ rule, subject, config, rules }) => {
    const key = KEYS.openIncident(rule.family, subject);
    const ttl = openIncidentTtl(config, rule.family, rules);
    const existing = await redis.get(key);
    if (existing) {
      await redis.pexpire(key, ttl);
      return { incidentId: existing, created: false };
    }
    const incidentId = ulid();
    const ok = await redis.set(key, incidentId, 'PX', ttl, 'NX');
    if (ok === 'OK') return { incidentId, created: true };
    return { incidentId: await redis.get(key), created: false };
  };

  const raiseFpStorm = async (config) => {
    if ((await redis.set(FP_STORM_KEY, '1', 'PX', FP_STORM_TTL_MS, 'NX')) !== 'OK') return;
    const at = new Date(now());
    log.error({ msg: 'system.fp_storm', activeBlockCap: config.global.activeBlockCap });
    await writeMongo('incident.fp_storm', () =>
      mongo.incidents.insertOne({
        _id: ulid(),
        family: 'system',
        ruleId: 'fp_storm',
        subject: 'system',
        subjectKind: 'system',
        severity: 'critical',
        status: 'open',
        summary: `Active block cap (${config.global.activeBlockCap}) reached: new detections are recorded as shadow`,
        detectedAt: at,
        lastSeenAt: at,
        actionIds: [],
        falsePositive: false,
        env,
      })
    );
  };

  return {
    async handle({ rule, subject, decision, event, ruleCfg, config, rules }) {
      const detectedAt = now();
      const { incidentId, created } = await findOrOpenIncident({ rule, subject, config, rules });

      const actions = [];
      for (const request of decision.actions) {
        const actionId = ulid();
        const requestedAt = now();
        let result = await checkSafeguards({ redis, env, mode: ruleCfg.mode, subject, global: config.global, now: requestedAt });
        let ttlMs = null;
        let strike = null;
        let expiresAt = null;
        let error;

        if (result === 'skipped_cap') await raiseFpStorm(config);
        if (!result) {
          const handler = handlerFor(handlers, request);
          if (handler?.needsTtl !== false) {
            ({ ttlMs, strike } = await computeTtl({ redis, request, family: rule.family, subject, global: config.global }));
          }
          try {
            if (!handler) throw new Error(`no handler for action type ${request.type}`);
            const value = { actionId, rule: rule.id, incidentId, expiresAt: ttlMs ? requestedAt + ttlMs : null };
            ({ result, expiresAt } = await handler.apply({ redis, scope: request.scope, subject, ttlMs, value, params: request.params, now: requestedAt }));
          } catch (err) {
            result = 'failed';
            error = err?.message?.slice(0, 200);
          }
        }

        const appliedAt = ENFORCED.has(result) ? now() : null;
        const action = {
          _id: actionId,
          incidentId,
          ruleId: rule.id,
          type: request.type,
          scope: request.scope,
          subject,
          mode: ruleCfg.mode,
          result,
          requestedAt: new Date(requestedAt),
          appliedAt: appliedAt ? new Date(appliedAt) : null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          ttlMs,
          strike,
          ...(request.params?.socketId ? { socketId: request.params.socketId } : {}), // random Socket.io id, not personal
          summary: decision.summary, // this firing's own reason, for the incident timeline
          triggerEventTs: event.ts,
          ttdMs: detectedAt - event.ts, // TTD: trigger event → detected (ARCH §14.2)
          latencyMs: appliedAt ? appliedAt - event.ts : null, // TTR: trigger event → applied
          ...(error ? { error } : {}),
        };
        actions.push(action);

        log.info({
          msg: 'action',
          incidentId,
          actionId,
          rule: rule.id,
          ruleVersion: rule.version,
          configVersion: config.version,
          family: rule.family,
          severity: decision.severity,
          subject: `ip:${subject}`,
          action: request.type,
          scope: request.scope,
          mode: ruleCfg.mode,
          result,
          ttlMs,
          strike,
          ttdMs: detectedAt - event.ts,
          ttrMs: appliedAt ? appliedAt - event.ts : null,
          observed: decision.evidence.observed,
          threshold: decision.evidence.threshold,
          windowMs: decision.evidence.windowMs,
          ...(error ? { error } : {}),
        });
      }

      const enforced = actions.some((a) => ENFORCED.has(a.result));
      // Nothing enforced because of shadow mode OR the kill switch: a would-have-acted incident.
      const allShadow = actions.every((a) => a.result === 'skipped_shadow' || a.result === 'skipped_killswitch');
      const actionIds = actions.map((a) => a._id);
      const seenAt = new Date(detectedAt);
      // What was done, for the console: socket throttles and disconnects leave
      // no Redis key, so the feed can't learn about them from /api/blocks.
      const done = actions.filter((a) => ENFORCED.has(a.result) || a.result === 'sent');
      const kinds = done.map((a) => (a.type === 'throttle' && a.scope === 'socket' ? 'socket_throttle' : a.type));
      const slowed = done.filter((a) => a.type === 'throttle' && a.scope === 'socket').map((a) => a.requestedAt.getTime() + a.ttlMs);
      const consoleFields = {
        ...(kinds.length ? { $addToSet: { rulesFired: rule.id, actionsTaken: { $each: kinds } } } : { $addToSet: { rulesFired: rule.id } }),
        ...(slowed.length ? { $max: { slowedUntil: new Date(Math.max(...slowed)) } } : {}),
      };

      await writeMongo('actions', () => (actions.length ? mongo.actions.insertMany(actions) : null));
      await writeMongo('incident', async () => {
        const current = created ? null : await mongo.incidents.findOne({ _id: incidentId }, { projection: { severity: 1, status: 1 } });
        if (!current) {
          await mongo.incidents.updateOne(
            { _id: incidentId },
            {
              $setOnInsert: {
                family: rule.family,
                subject,
                subjectKind: 'ip',
                firstEventTs: event.ts,
                detectedAt: seenAt,
                closedAt: null,
                falsePositive: false,
                env,
              },
              $set: {
                ruleId: rule.id,
                ruleVersion: rule.version,
                configVersion: config.version,
                severity: decision.severity,
                status: enforced || !allShadow ? 'open' : 'shadow',
                summary: decision.summary,
                evidence: decision.evidence,
                fieldsUsed: decision.fieldsUsed,
                triggerEventTs: event.ts,
                lastSeenAt: seenAt,
              },
              ...consoleFields,
              $push: { actionIds: { $each: actionIds } },
            },
            { upsert: true }
          );
          return;
        }
        await mongo.incidents.updateOne(
          { _id: incidentId },
          {
            $set: {
              ruleId: rule.id,
              ruleVersion: rule.version,
              configVersion: config.version,
              severity: maxSeverity(current.severity, decision.severity),
              status: enforced ? 'open' : current.status,
              summary: decision.summary,
              evidence: decision.evidence,
              fieldsUsed: decision.fieldsUsed,
              triggerEventTs: event.ts,
              lastSeenAt: seenAt,
            },
            ...consoleFields,
            $push: { actionIds: { $each: actionIds } },
          }
        );
      });

      if (bus) {
        try {
          // Blocks and actions go out BEFORE the incident, so a console row is
          // born with its real state ("Throttled · auth"), never flashing
          // "Resolved · expired" for the moment before block.added arrives.
          const incident = mongo ? await mongo.incidents.findOne({ _id: incidentId }) : null;
          const at = now();
          for (const a of actions) {
            if (!ENFORCED.has(a.result) || !a.expiresAt) continue;
            bus.emit(
              'block.added',
              toBlockItem({
                level: a.type === 'block' ? 'block' : 'throttle',
                scope: a.scope,
                subject,
                value: { rule: rule.id, actionId: a._id, incidentId },
                ttlMs: Math.max(0, a.expiresAt.getTime() - at),
                now: at,
              })
            );
          }
          for (const a of actions) bus.emit('action.applied', a);
          if (incident) bus.emit(created ? 'incident.created' : 'incident.updated', incident);
        } catch (err) {
          log.warn({ msg: 'realtime.publish_failed', error: err?.message?.slice(0, 200) });
        }
      }

      return { incidentId, created, actions };
    },
  };
};

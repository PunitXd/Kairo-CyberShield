// Operator unblock with undo (ARCH §4.3, BRIEF Flow B).
//
// unblock(scope, subject):
//   1. Save each enforcement key's value and remaining PTTL (block, throttle)
//      plus the open-incident key, then delete them, the throttle token gate
//      and the kairo:blocks:active entry in one MULTI. The next request from
//      that source is a normal one (401 on a bad login, not 429 or 403).
//      Deleting the open-incident key means a re-trip opens a NEW incident.
//   2. Mongo: actions → liftedAt/liftedBy, incidents → manually_resolved,
//      and one audit_log entry (append-only).
//   3. Publish block.removed + incident.updated, return an unguessable undo
//      token. The toast offers Undo for 10 s and pauses while hovered or
//      focused (BRIEF §7); the server honours the token for a 30 s grace so a
//      paused toast never offers an Undo the server would refuse (decided
//      Oct 19; ARCH §4.3 said 10 s).
// undo(token): put the keys back with their REMAINING TTL (never longer than
// they had left), restore the incident's previous status, audit it, publish
// block.added + incident.updated. A token works once.
//
// Unblocking reduces enforcement, so it needs no confirmation (BRIEF
// principle 1). Undo state lives in memory: one Defender, 30-second grace.

import { randomBytes } from 'node:crypto';

import { ulid } from 'ulid';

import { KEYS } from '../defender.constant.js';
import { toBlockItem } from './block.service.js';

export const UNDO_WINDOW_MS = 30_000; // server grace; the toast itself shows for 10 s
const SCOPE_FAMILY = { auth: 'auth', room_join: 'room' };

const parseValue = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export const createUnblockService = ({ redis, mongo, bus, log, hasher = null, now = Date.now }) => {
  const pending = new Map(); // undoToken -> saved state

  const writeMongo = async (what, fn) => {
    if (!mongo) return;
    try {
      await fn();
    } catch (err) {
      log?.error({ msg: 'mongo.write_failed', what, error: err?.message?.slice(0, 200) });
    }
  };

  const audit = (op, { scope, subject, actorIp, before, after }) =>
    writeMongo('audit_log', () =>
      mongo.auditLog.insertOne({
        _id: ulid(),
        at: new Date(now()),
        actor: 'operator', // no console login in the Demo MVP (PHASES §0)
        actorIpHash: actorIp && hasher ? hasher.ip(actorIp) : null,
        op,
        target: { scope, subject },
        before,
        after,
      })
    );

  const publishIncidents = async (incidentIds) => {
    if (!mongo || !bus) return;
    for (const _id of incidentIds) {
      const incident = await mongo.incidents.findOne({ _id });
      if (incident) bus.emit('incident.updated', incident);
    }
  };

  return {
    /** @returns {Promise<{undoToken, undoExpiresAt, removed} | null>} null when nothing was active */
    async unblock(scope, subject, { actorIp } = {}) {
      const family = SCOPE_FAMILY[scope];
      const enforcement = [
        { level: 'block', key: KEYS.block(scope, subject) },
        { level: 'throttle', key: KEYS.throttle(scope, subject) },
      ];
      const openKey = KEYS.openIncident(family, subject);

      const pipe = redis.pipeline();
      for (const { key } of [...enforcement, { key: openKey }]) pipe.get(key).pttl(key);
      const res = await pipe.exec();
      const read = (i) => ({ value: res[i * 2]?.[1] ?? null, pttl: res[i * 2 + 1]?.[1] ?? -2 });

      const saved = enforcement
        .map((e, i) => ({ ...e, ...read(i) }))
        .filter((e) => e.value !== null && e.pttl > 0);
      if (!saved.length) return null;
      const openIncident = read(enforcement.length);

      const at = now();
      await redis
        .multi()
        .del(...enforcement.map((e) => e.key), KEYS.tokenGate(scope, subject), openKey)
        .zrem(KEYS.blocksActive, `${scope}:${subject}`)
        .exec();

      const values = saved.map((s) => parseValue(s.value));
      const incidentIds = [...new Set(values.map((v) => v.incidentId).filter(Boolean))];
      const actionIds = [...new Set(values.map((v) => v.actionId).filter(Boolean))];

      let previousIncidents = [];
      await writeMongo('unblock', async () => {
        previousIncidents = await mongo.incidents
          .find({ _id: { $in: incidentIds } }, { projection: { status: 1, closedAt: 1 } })
          .toArray();
        await mongo.incidents.updateMany({ _id: { $in: incidentIds } }, { $set: { status: 'manually_resolved', closedAt: new Date(at) } });
        await mongo.actions.updateMany({ _id: { $in: actionIds } }, { $set: { liftedAt: new Date(at), liftedBy: 'operator' } });
      });
      await audit('unblock', {
        scope,
        subject,
        actorIp,
        before: { keys: saved.map((s) => ({ level: s.level, ttlMs: s.pttl, rule: parseValue(s.value).rule ?? null })), incidentIds },
        after: { keys: [], incidentStatus: 'manually_resolved' },
      });

      const undoToken = randomBytes(16).toString('hex');
      const undoExpiresAt = at + UNDO_WINDOW_MS;
      pending.set(undoToken, { scope, subject, saved, openKey, openIncident, savedAt: at, previousIncidents, incidentIds, actionIds, expiresAt: undoExpiresAt });
      setTimeout(() => pending.delete(undoToken), UNDO_WINDOW_MS + 1000).unref?.();

      if (bus) {
        saved.forEach((s, i) => bus.emit('block.removed', { ...toBlockItem({ level: s.level, scope, subject, value: values[i], ttlMs: 0, now: at }), reason: 'unblocked' }));
        await publishIncidents(incidentIds);
      }
      log?.info({ msg: 'operator.unblock', scope, subject: `ip:${subject}`, removed: saved.length, incidentIds });
      return { undoToken, undoExpiresAt, removed: saved.length };
    },

    /** @returns {Promise<{restored} | null>} null when the token is unknown, used or expired */
    async undo(token, { actorIp } = {}) {
      const p = pending.get(token);
      pending.delete(token); // single use, whatever happens next
      const at = now();
      if (!p || at > p.expiresAt) return null;

      const elapsed = at - p.savedAt;
      const restored = [];
      const multi = redis.multi();
      for (const s of p.saved) {
        const remaining = s.pttl - elapsed;
        if (remaining <= 0) continue; // expired anyway in the meantime
        multi.set(s.key, s.value, 'PX', remaining, 'NX'); // never clobber a newer key from a re-trip
        if (s.level === 'block') multi.zadd(KEYS.blocksActive, at + remaining, `${p.scope}:${p.subject}`);
        restored.push({ ...s, remaining });
      }
      if (p.openIncident.value && p.openIncident.pttl - elapsed > 0) {
        multi.set(p.openKey, p.openIncident.value, 'PX', p.openIncident.pttl - elapsed, 'NX');
      }
      await multi.exec();

      await writeMongo('undo_unblock', async () => {
        for (const prev of p.previousIncidents) {
          await mongo.incidents.updateOne({ _id: prev._id }, { $set: { status: prev.status, closedAt: prev.closedAt ?? null } });
        }
        await mongo.actions.updateMany({ _id: { $in: p.actionIds } }, { $unset: { liftedAt: '', liftedBy: '' } });
      });
      await audit('undo_unblock', {
        scope: p.scope,
        subject: p.subject,
        actorIp,
        before: { keys: [] },
        after: { keys: restored.map((r) => ({ level: r.level, ttlMs: r.remaining })) },
      });

      if (bus) {
        for (const r of restored) {
          bus.emit('block.added', toBlockItem({ level: r.level, scope: p.scope, subject: p.subject, value: parseValue(r.value), ttlMs: r.remaining, now: at }));
        }
        await publishIncidents(p.incidentIds);
      }
      log?.info({ msg: 'operator.undo_unblock', scope: p.scope, subject: `ip:${p.subject}`, restored: restored.length });
      return { restored: restored.length };
    },
  };
};

// Allowlist (ARCH §7.2 safeguard 4, §8, §9.2; BRIEF Flow B).
//
// kairo:allow:{ipHash} is what enforcement reads: every hook checks it first
// (an allowlisted source passes even with an active block) and the Defender
// records skipped_allowlist instead of acting. The key always has a TTL.
// Mongo `allowlist` keeps the operator's reason and expiry for the console;
// the Redis key is the truth, so list() starts from the keys. Every add and
// remove is audited. Only ever hashes: a typed IP is hashed by the controller
// and never stored or logged.

import { ulid } from 'ulid';

import { KEYS } from '../defender.constant.js';

const HOUR_MS = 3600_000;

const scanKeys = async (redis, pattern) => {
  const out = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    out.push(...keys);
  } while (cursor !== '0');
  return out;
};

const parse = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export const createAllowlistService = ({ redis, mongo, bus = null, log, hasher = null, now = Date.now }) => {
  const writeMongo = async (what, fn) => {
    if (!mongo) return;
    try {
      await fn();
    } catch (err) {
      log?.error({ msg: 'mongo.write_failed', what, error: err?.message?.slice(0, 200) });
    }
  };
  const audit = (op, { subject, actorIp, before, after }) =>
    writeMongo('audit_log', () =>
      mongo.auditLog.insertOne({
        _id: ulid(),
        at: new Date(now()),
        actor: 'operator',
        actorIpHash: actorIp && hasher ? hasher.ip(actorIp) : null,
        op,
        target: { subject },
        before,
        after,
      })
    );

  return {
    /** Allowlist one source hash for `hours` → the entry. Replaces an existing entry (new expiry). */
    async add({ subject, hours, reason = null, source = 'manual', incidentId = null, actorIp }) {
      const at = now();
      const ttlMs = hours * HOUR_MS;
      const expiresAt = at + ttlMs;
      const before = await redis.pttl(KEYS.allow(subject));
      await redis.set(KEYS.allow(subject), JSON.stringify({ by: 'operator', at, source }), 'PX', ttlMs);
      const entry = { subject, kind: 'ip', reason, source, incidentId, createdBy: 'operator', createdAt: new Date(at), expiresAt: new Date(expiresAt) };
      await writeMongo('allowlist', () =>
        mongo.allowlist.updateOne({ subject }, { $set: entry, $setOnInsert: { _id: ulid() } }, { upsert: true })
      );
      await audit('allowlist_add', { subject, actorIp, before: before > 0 ? { ttlMs: before } : null, after: { ttlMs, source, incidentId } });
      log?.warn({ msg: 'operator.allowlist_add', subject: `ip:${subject}`, hours, source });
      bus?.emit('allowlist.changed', { subject, on: true });
      return { subject, kind: 'ip', reason, source, incidentId, createdAt: at, expiresAt };
    },

    /** Remove one entry → { removed }. */
    async remove(subject, { actorIp } = {}) {
      const removed = await redis.del(KEYS.allow(subject));
      await writeMongo('allowlist', () => mongo.allowlist.deleteOne({ subject }));
      if (removed) {
        await audit('allowlist_remove', { subject, actorIp, before: { allowlisted: true }, after: { allowlisted: false } });
        log?.warn({ msg: 'operator.allowlist_remove', subject: `ip:${subject}` });
        bus?.emit('allowlist.changed', { subject, on: false });
      }
      return { removed: removed > 0 };
    },

    /** Every live entry, soonest expiry first. */
    async list() {
      const keys = await scanKeys(redis, 'kairo:allow:*');
      if (!keys.length) return [];
      const subjects = keys.map((k) => k.slice('kairo:allow:'.length));
      const [values, ttls] = await Promise.all([redis.mget(...keys), Promise.all(keys.map((k) => redis.pttl(k)))]);
      let docs = [];
      try {
        docs = mongo ? await mongo.allowlist.find({ subject: { $in: subjects } }).toArray() : [];
      } catch (err) {
        log?.warn({ msg: 'mongo.read_failed', what: 'allowlist', error: err?.message?.slice(0, 200) });
      }
      const bySubject = new Map(docs.map((d) => [d.subject, d]));
      const t = now();
      return subjects
        .map((subject, i) => {
          const doc = bySubject.get(subject);
          const v = parse(values[i]);
          return {
            subject,
            kind: 'ip',
            reason: doc?.reason ?? null,
            source: doc?.source ?? v.source ?? 'manual',
            incidentId: doc?.incidentId ?? null,
            createdAt: v.at ?? (doc?.createdAt ? new Date(doc.createdAt).getTime() : null),
            expiresAt: ttls[i] > 0 ? t + ttls[i] : null,
          };
        })
        .filter((e) => e.expiresAt)
        .sort((a, b) => a.expiresAt - b.expiresAt);
    },
  };
};

// System status for GET /api/health and the `system.status` realtime event
// (ARCH §9.2). Each dependency probe is capped so a hung Redis or Mongo makes
// the status say "down" instead of hanging the console.

import { KEYS } from '../defender.constant.js';
import { withTimeout } from '../utils/withTimeout.js';

const PROBE_TIMEOUT_MS = 1000;
const HEARTBEAT_PATTERN = 'kairo:hb:hooks:*';

/** Live hooks heartbeats → Map(inst → { heartbeatAt, lastEventAt }). Empty on any error. */
const readHeartbeats = async (redis) => {
  const out = new Map();
  try {
    const keys = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', HEARTBEAT_PATTERN, 'COUNT', 100);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0' && keys.length < 50);
    const values = keys.length ? await redis.mget(...keys) : [];
    keys.forEach((key, i) => {
      try {
        const v = JSON.parse(values[i]);
        out.set(key.slice(HEARTBEAT_PATTERN.length - 1), { heartbeatAt: Number(v.at) || null, lastEventAt: Number(v.lastEventAt) || null });
      } catch {
        /* not ours */
      }
    });
  } catch {
    /* status must not fail because of heartbeats */
  }
  return out;
};

const probe = async (fn, what) => {
  try {
    await withTimeout(fn(), PROBE_TIMEOUT_MS, what);
    return 'ok';
  } catch {
    return 'down';
  }
};

export const getSystemStatus = async ({ redis, mongo, env, getConsumerStats, getRules, getCypherfyHealth, getRollbackState, now = Date.now() }) => {
  const [redisStatus, mongoStatus] = await Promise.all([
    probe(() => redis.ping(), 'redis ping'),
    probe(() => mongo.db.command({ ping: 1 }), 'mongo ping'),
  ]);

  let killSwitch = false;
  let killSwitchSince = null;
  let heartbeats = new Map();
  if (redisStatus === 'ok') {
    heartbeats = await withTimeout(readHeartbeats(redis), PROBE_TIMEOUT_MS, 'heartbeats').catch(() => new Map());
    try {
      const raw = await withTimeout(redis.get(KEYS.killswitch), PROBE_TIMEOUT_MS, 'killswitch');
      killSwitch = Boolean(raw);
      if (raw) {
        try {
          killSwitchSince = Number(JSON.parse(raw).at) || null;
        } catch {
          killSwitchSince = null;
        }
      }
    } catch {
      killSwitch = false;
    }
  }

  let rollback = null;
  if (redisStatus === 'ok' && getRollbackState) rollback = await withTimeout(getRollbackState(), PROBE_TIMEOUT_MS, 'rollback').catch(() => null);
  const health = getCypherfyHealth?.() ?? null;

  const stats = getConsumerStats?.() ?? {};
  return {
    defender: 'ok',
    redis: redisStatus,
    mongo: mongoStatus,
    // ARCH §14.2: now − ts of the last processed event (null before the first one).
    consumerLagMs: stats.lastEventTs ? now - stats.lastEventTs : null,
    // One row per CypherFy instance: alive while its heartbeat key exists (the
    // hooks refresh it every 10 s), lastEventAt from the newest of what the
    // Defender processed and what the hooks report.
    hooks: [...new Set([...heartbeats.keys(), ...Object.keys(stats.lastEventAtByInst ?? {})])].sort().map((inst) => {
      const hb = heartbeats.get(inst);
      const seen = Math.max(stats.lastEventAtByInst?.[inst] ?? 0, hb?.lastEventAt ?? 0);
      return { inst, alive: Boolean(hb), heartbeatAt: hb?.heartbeatAt ?? null, lastEventAt: seen || null };
    }),
    killSwitch,
    killSwitchSince,
    env,
    // Rule modes from rules.json, so an empty console can say what Kairo is watching.
    rules: getRules?.() ?? [],
    // CypherFy's own /api/v1/health, probed every 10 s (R4, BRIEF D5).
    cypherfy: health ? { ok: health.ok, httpStatus: health.httpStatus, status: health.status, error: health.error, checkedAt: health.at, failuresInARow: health.failuresInARow } : null,
    // R4: automation frozen, and when the next automatic rollback is allowed.
    rollback,
  };
};

/** The part of the status that changes meaningfully; used to decide when to push. */
export const statusFingerprint = (s) =>
  JSON.stringify({
    redis: s.redis,
    mongo: s.mongo,
    killSwitch: s.killSwitch,
    env: s.env,
    rules: s.rules,
    hooks: s.hooks.map((h) => `${h.inst}:${h.alive}`).sort(),
    cypherfy: s.cypherfy?.ok ?? null,
    rollback: s.rollback ? [s.rollback.frozen, s.rollback.budgetAvailableAt !== null] : null,
  });

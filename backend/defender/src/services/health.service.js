// System status for GET /api/health and the `system.status` realtime event
// (ARCH §9.2). Each dependency probe is capped so a hung Redis or Mongo makes
// the status say "down" instead of hanging the console.

import { KEYS } from '../defender.constant.js';
import { withTimeout } from '../utils/withTimeout.js';

const PROBE_TIMEOUT_MS = 1000;

const probe = async (fn, what) => {
  try {
    await withTimeout(fn(), PROBE_TIMEOUT_MS, what);
    return 'ok';
  } catch {
    return 'down';
  }
};

export const getSystemStatus = async ({ redis, mongo, env, getConsumerStats, now = Date.now() }) => {
  const [redisStatus, mongoStatus] = await Promise.all([
    probe(() => redis.ping(), 'redis ping'),
    probe(() => mongo.db.command({ ping: 1 }), 'mongo ping'),
  ]);

  let killSwitch = false;
  if (redisStatus === 'ok') {
    try {
      killSwitch = Boolean(await withTimeout(redis.get(KEYS.killswitch), PROBE_TIMEOUT_MS, 'killswitch'));
    } catch {
      killSwitch = false;
    }
  }

  const stats = getConsumerStats?.() ?? {};
  return {
    defender: 'ok',
    redis: redisStatus,
    mongo: mongoStatus,
    // ARCH §14.2: now − ts of the last processed event (null before the first one).
    consumerLagMs: stats.lastEventTs ? now - stats.lastEventTs : null,
    hooks: Object.entries(stats.lastEventAtByInst ?? {}).map(([inst, lastEventAt]) => ({ inst, lastEventAt })),
    killSwitch,
    env,
  };
};

/** The part of the status that changes meaningfully; used to decide when to push. */
export const statusFingerprint = (s) =>
  JSON.stringify({ redis: s.redis, mongo: s.mongo, killSwitch: s.killSwitch, env: s.env, hooks: s.hooks.map((h) => h.inst).sort() });

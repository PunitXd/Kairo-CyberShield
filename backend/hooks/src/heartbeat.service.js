// Hooks heartbeat (ARCH §8.1): every 10 s, SET kairo:hb:hooks:{inst} with the
// time of the last event this instance wrote, PX 30 s. The key existing means
// the hooks are loaded and can reach Redis, even when nobody is using CypherFy;
// its value says how long ago real traffic was seen. Fails silently.

import { KEYS } from './schema/index.js';
import { withTimeout } from './redis.service.js';

export const HEARTBEAT_EVERY_MS = 10_000;
export const HEARTBEAT_TTL_MS = 30_000;

export const createHeartbeat = ({ redis, emitter, inst, timeoutMs, log, now = Date.now, everyMs = HEARTBEAT_EVERY_MS }) => {
  const beat = async () => {
    try {
      const value = JSON.stringify({ at: now(), lastEventAt: emitter.lastEventAt });
      await withTimeout(redis.set(KEYS.hooksHeartbeat(inst), value, 'PX', HEARTBEAT_TTL_MS), timeoutMs);
    } catch {
      log('kairo.redis_unavailable', { op: 'heartbeat' });
    }
  };
  const timer = everyMs > 0 ? setInterval(beat, everyMs) : null;
  timer?.unref?.();
  return { beat, stop: () => timer && clearInterval(timer) };
};

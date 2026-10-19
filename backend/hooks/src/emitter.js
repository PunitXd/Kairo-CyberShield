// Metadata-only event emitter. Every event goes through the strict schema
// (toStreamFields validates) before XADD, so a field outside the allowlist,
// such as a message body, raw IP or email, is dropped here and never reaches
// Redis. Fire-and-forget: emit() never throws and never blocks a response.

import { KEYS, STREAM_MAXLEN, toStreamFields } from './schema/index.js';
import { withTimeout } from './redis.js';

export const createEmitter = ({ redis, timeoutMs, log }) => ({
  /** @returns {Promise<boolean>} true if the event was written */
  async emit(event) {
    let fields;
    try {
      fields = toStreamFields(event);
    } catch (err) {
      // Paths and codes only: the rejected values may be exactly what must not leak.
      const issues = (err?.issues ?? []).map((i) => `${i.path.join('.') || '(root)'}:${i.code}`).slice(0, 5);
      log('kairo.event_invalid', { issues });
      return false;
    }
    try {
      await withTimeout(redis.xadd(KEYS.events, 'MAXLEN', '~', STREAM_MAXLEN, '*', ...fields), timeoutMs);
      return true;
    } catch {
      log('kairo.redis_unavailable', { op: 'xadd' });
      return false;
    }
  },
});

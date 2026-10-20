// Lift knock mode on a room early (R2b, PHASES Oct 21 #1): DELETE the
// kairo:knock:{codeHash} key the operator found on an R2b incident. Audited
// like an unblock. The codeHash is a hash, never the raw room code.

import { ulid } from 'ulid';

import { KEYS } from '../defender.constant.js';
import { isRedisReady, REDIS_UNAVAILABLE, withRedis } from '../utils/withRedis.js';

export const createKnockService = ({ redis, mongo, log, hasher, now = Date.now }) => ({
  /** @returns {Promise<{ removed: number }>} */
  async lift(codeHash, { actorIp } = {}) {
    if (!isRedisReady(redis)) throw REDIS_UNAVAILABLE();
    const removed = await withRedis(redis, () => redis.del(KEYS.knock(codeHash)));
    if (mongo) {
      try {
        await mongo.auditLog.insertOne({
          _id: ulid(),
          at: new Date(now()),
          actor: 'operator',
          actorIpHash: actorIp && hasher ? hasher.ip(actorIp) : null,
          op: 'knock.lift',
          target: { scope: 'knock', subject: codeHash },
          before: { active: removed > 0 },
          after: { active: false },
        });
      } catch (err) {
        log.error({ msg: 'mongo.write_failed', what: 'audit.knock', error: err?.message?.slice(0, 200) });
      }
    }
    return { removed };
  },
});

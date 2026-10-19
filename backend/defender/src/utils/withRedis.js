// Redis calls made for an operator request (ARCH §12 "Redis down"). ioredis
// queues commands while disconnected and replays them on reconnect, so an API
// call would hang, and a queued unblock could run minutes after the console
// was told it failed. Instead: refuse at once unless the client is connected,
// and give up after timeoutMs. Either way the console gets 503 REDIS_UNAVAILABLE.

import { ApiError } from './ApiError.js';
import { withTimeout } from './withTimeout.js';

export const REDIS_UNAVAILABLE = () => new ApiError(503, 'REDIS_UNAVAILABLE', 'Redis is unreachable, so blocks cannot be read or changed');

/** True when the client can take a command now (fakes without a status count as ready). */
export const isRedisReady = (redis) => !redis?.status || redis.status === 'ready';

export const withRedis = async (redis, fn, { timeoutMs = 1500 } = {}) => {
  if (!isRedisReady(redis)) throw REDIS_UNAVAILABLE();
  try {
    return await withTimeout(fn(), timeoutMs, 'redis');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw REDIS_UNAVAILABLE();
  }
};

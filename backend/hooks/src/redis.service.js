// The hooks' own Redis connection, separate from CypherFy's client so Kairo's
// timeouts and failures can never affect CypherFy's adapter or limiter.
//
// Fail open (ARCH §4.2, §13): every call is capped at KAIRO_REDIS_TIMEOUT_MS
// (50 ms), the offline queue is off so commands fail at once while Redis is
// down, and callers treat any error as "allow the request, skip the event".

import Redis from 'ioredis';

export const DEFAULT_TIMEOUT_MS = 50;

export const createRedis = (url, onError) => {
  const client = new Redis(url, {
    enableOfflineQueue: false, // fail immediately instead of buffering while down
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 200, 2000), // keep reconnecting in the background
  });
  client.on('error', (err) => onError?.(err));
  return client;
};

/** Reject if `promise` hasn't settled within `ms`. */
export const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`redis timeout after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

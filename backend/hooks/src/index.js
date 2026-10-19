// cypherfy-hooks entry point. CypherFy's whole integration:
//
//   index.js:  import { initKairo } from './kairo/index.js';
//              .then(() => initKairo())             // after connectRedis()
//   app.js:    import { kairoMiddleware } from './kairo/index.js';
//              app.use(kairoMiddleware);            // after cookieParser()
//
// kairoMiddleware is registered when app.js loads, before initKairo() runs, so
// it passes everything through until initKairo() succeeds. Misconfiguration
// (KAIRO_ENABLED not "true", missing secret or Redis URL) leaves the hooks as a
// no-op and logs `kairo.disabled` once (ARCH §13).

import { createHasher } from './schema/index.js';
import { DEFAULT_TIMEOUT_MS, createRedis } from './redis.service.js';
import { createEmitter } from './emitter.service.js';
import { createHttpMiddleware } from './http.middleware.js';
import { createLogger, logInfo } from './utils/logger.js';

const ENVS = ['staging', 'production', 'local'];

let middleware = null;
let started = false;

export const initKairo = async ({ env = process.env } = {}) => {
  if (started) return;
  started = true;
  const log = createLogger();

  try {
    if (env.KAIRO_ENABLED !== 'true') return logInfo('kairo.disabled', { reason: 'KAIRO_ENABLED is not true' });
    if (!ENVS.includes(env.KAIRO_ENV)) return logInfo('kairo.disabled', { reason: 'KAIRO_ENV must be staging, production or local' });
    if (!env.KAIRO_REDIS_URL) return logInfo('kairo.disabled', { reason: 'KAIRO_REDIS_URL is not set' });

    let hasher;
    try {
      hasher = createHasher(env.KAIRO_HASH_SECRET);
    } catch {
      return logInfo('kairo.disabled', { reason: 'KAIRO_HASH_SECRET missing or shorter than 32 characters' });
    }

    const timeoutMs = Number(env.KAIRO_REDIS_TIMEOUT_MS) > 0 ? Number(env.KAIRO_REDIS_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    const redis = createRedis(env.KAIRO_REDIS_URL, () => log('kairo.redis_unavailable', { op: 'connection' }));
    const inst = String(env.HOSTNAME || env.RENDER_INSTANCE_ID || 'cypherfy').slice(0, 32);
    const emitter = createEmitter({ redis, timeoutMs, log });

    middleware = createHttpMiddleware({ redis, emitter, hasher, env: env.KAIRO_ENV, inst, timeoutMs, log });
    logInfo('kairo.enabled', { env: env.KAIRO_ENV, inst, timeoutMs, enforce: env.KAIRO_ENV !== 'production' });
  } catch (err) {
    middleware = null;
    logInfo('kairo.disabled', { reason: 'init failed', error: err?.message?.slice(0, 120) });
  }
};

/** Express middleware; a pass-through until initKairo() has succeeded. */
export const kairoMiddleware = (req, res, next) => {
  if (!middleware) return next();
  return middleware(req, res, next);
};

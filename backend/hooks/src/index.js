// cypherfy-hooks entry point. CypherFy's whole integration:
//
//   index.js:  import * as kairo from './kairo/index.js';
//              .then(() => kairo.init())            // after connectRedis()
//   app.js:    import * as kairo from './kairo/index.js';
//              app.use(kairo.http());               // after cookieParser()
//
// http() is registered when app.js loads, before init() runs, so it returns a
// stable middleware that passes everything through until init() succeeds.
// Misconfiguration (KAIRO_ENABLED not "true", missing secret or Redis URL)
// leaves the hooks as a no-op and logs `kairo.disabled` once (ARCH §13).

import { createHasher } from './schema/index.js';
import { DEFAULT_TIMEOUT_MS, createLogger, createRedis } from './redis.js';
import { createEmitter } from './emitter.js';
import { createHttpHooks } from './http.js';

const ENVS = ['staging', 'production', 'local'];

let middleware = null;
let started = false;

export const init = async ({ env = process.env } = {}) => {
  if (started) return;
  started = true;
  const log = createLogger();
  const info = (msg, fields = {}) =>
    console.log(JSON.stringify({ time: new Date().toISOString(), level: 'info', svc: 'hooks', msg, ...fields }));

  try {
    if (env.KAIRO_ENABLED !== 'true') return info('kairo.disabled', { reason: 'KAIRO_ENABLED is not true' });
    if (!ENVS.includes(env.KAIRO_ENV)) return info('kairo.disabled', { reason: 'KAIRO_ENV must be staging, production or local' });
    if (!env.KAIRO_REDIS_URL) return info('kairo.disabled', { reason: 'KAIRO_REDIS_URL is not set' });

    let hasher;
    try {
      hasher = createHasher(env.KAIRO_HASH_SECRET);
    } catch {
      return info('kairo.disabled', { reason: 'KAIRO_HASH_SECRET missing or shorter than 32 characters' });
    }

    const timeoutMs = Number(env.KAIRO_REDIS_TIMEOUT_MS) > 0 ? Number(env.KAIRO_REDIS_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
    const redis = createRedis(env.KAIRO_REDIS_URL, () => log('kairo.redis_unavailable', { op: 'connection' }));
    const inst = String(env.HOSTNAME || env.RENDER_INSTANCE_ID || 'cypherfy').slice(0, 32);
    const emitter = createEmitter({ redis, timeoutMs, log });

    middleware = createHttpHooks({ redis, emitter, hasher, env: env.KAIRO_ENV, inst, timeoutMs, log });
    info('kairo.enabled', { env: env.KAIRO_ENV, inst, timeoutMs, enforce: env.KAIRO_ENV !== 'production' });
  } catch (err) {
    middleware = null;
    info('kairo.disabled', { reason: 'init failed', error: err?.message?.slice(0, 120) });
  }
};

export const http = () =>
  function kairo(req, res, next) {
    if (!middleware) return next();
    return middleware(req, res, next);
  };

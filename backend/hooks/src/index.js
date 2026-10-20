// cypherfy-hooks entry point. CypherFy's whole integration (ARCH §3.1):
//
//   index.js:          import { initKairo } from './kairo/index.js';
//                      .then(() => initKairo())             // after connectRedis()
//   app.js:            import { kairoMiddleware } from './kairo/index.js';
//                      app.use(kairoMiddleware);            // after cookieParser()
//   socket/index.js:   import { kairoSocket } from '../kairo/index.js';
//                      kairoSocket(io);                     // after CypherFy's io.use(auth)
//   index.js:          initKairo({ roomExists })           // roomExists(code) → boolean, for R2b
//   room.handler.js,   import { denyJoin, knockRequired } from '../../kairo/index.js';
//   knock.handler.js:  if (await denyJoin(socket, code)) return;   // before Room.findOne
//   room.handler.js:   knockRequired(socket, room)                 // by the isLocked check
//
// Every entry point is a pass-through until initKairo() succeeds.
// Misconfiguration (KAIRO_ENABLED not "true", missing secret or Redis URL)
// leaves the hooks as a no-op and logs `kairo.disabled` once (ARCH §13).

import { createHasher } from './schema/index.js';
import { DEFAULT_TIMEOUT_MS, createRedis } from './redis.service.js';
import { createEmitter } from './emitter.service.js';
import { createHttpMiddleware } from './http.middleware.js';
import { attachSocketLayer, createSocketLayer } from './socket.middleware.js';
import { createJoinGuard } from './joinGuard.service.js';
import { createCommandService } from './command.service.js';
import { createHeartbeat } from './heartbeat.service.js';
import { createLogger, logInfo } from './utils/logger.js';

const ENVS = ['staging', 'production', 'local'];

let middleware = null;
let started = false;
let context = null; // set once initKairo() succeeds
let io = null; // set by kairoSocket()
let socketLayer = null;
let joinGuard = null;

// The socket side needs both the init context and CypherFy's io; whichever
// arrives second starts it.
const startSocketSide = () => {
  if (!context || !io || socketLayer) return;
  try {
    socketLayer = createSocketLayer({ io, ...context });
    joinGuard = createJoinGuard({ layer: socketLayer, ...context });
    const subscriber = context.redis.duplicate();
    subscriber.on('error', () => context.log('kairo.redis_unavailable', { op: 'subscriber' }));
    createCommandService({ subscriber, layer: socketLayer, ...context }).start();
  } catch (err) {
    socketLayer = null;
    joinGuard = null;
    logInfo('kairo.socket_disabled', { reason: 'init failed', error: err?.message?.slice(0, 120) });
  }
};

export const initKairo = async ({ env = process.env, roomExists = null } = {}) => {
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
    context = { redis, emitter, hasher, env: env.KAIRO_ENV, inst, timeoutMs, log, roomExists };
    createHeartbeat({ redis, emitter, inst, timeoutMs, log }).beat();
    startSocketSide();
    logInfo('kairo.enabled', { env: env.KAIRO_ENV, inst, timeoutMs, enforce: env.KAIRO_ENV !== 'production' });
  } catch (err) {
    middleware = null;
    context = null;
    logInfo('kairo.disabled', { reason: 'init failed', error: err?.message?.slice(0, 120) });
  }
};

/** Express middleware; a pass-through until initKairo() has succeeded. */
export const kairoMiddleware = (req, res, next) => {
  if (!middleware) return next();
  return middleware(req, res, next);
};

/** Attach the socket guard, observers and command handling to CypherFy's io. */
export const kairoSocket = (ioInstance) => {
  try {
    if (io) return;
    io = ioInstance;
    attachSocketLayer(io, () => socketLayer);
    startSocketSide();
  } catch (err) {
    logInfo('kairo.socket_disabled', { reason: 'attach failed', error: err?.message?.slice(0, 120) });
  }
};

/** True when Kairo refused this join (the reply is already sent); false otherwise, including on any error. */
export const denyJoin = async (socket, code) => (joinGuard ? joinGuard.denyJoin(socket, code) : false);

/** True when the room is in Kairo knock mode (R2b); CypherFy's own host/admitted logic gates who is exempt. */
export const knockRequired = async (socket, room) => (joinGuard ? joinGuard.knockRequired(socket, room) : false);

// Socket.io layer (ARCH §3.1, §4.2): guard → observe → obey.
//
// 1. Guard (io.use, registered after CypherFy's own auth): refuse the handshake
//    with KAIRO_BLOCKED when the source has a `socket`-scope block. Logged-in
//    sockets (socket.data.userId) skip this IP-scoped check, so a real user
//    behind the attacker's NAT stays connected. Allowlist and kill switch pass.
// 2. Observe, per connection:
//      socket.connect / socket.disconnect
//      socket.use counts packets per event name → one socket.rate per socket
//      per second (names only: payloads are never read, except a join/knock
//      room code, which is hashed the moment the packet arrives)
//      a one-time socket.emit wrapper turns CypherFy's own error replies into
//      room.join.invalid (ROOM_NOT_FOUND / INVALID_CODE answering join_room or
//      knock) and socket.invalid_payload (BAD_PAYLOAD); room_joined answering
//      join_room → room.join.success. Each packet runs CypherFy's handler
//      inside an AsyncLocalStorage context, so a reply is matched to the
//      packet that caused it even when the handler awaits and newer packets
//      arrive meanwhile (matching on "the last packet" would let a flood of
//      other events hide the guesses).
// 3. Obey the Defender: throttle a socket (in-process token bucket; excess
//    packets are dropped and the client gets SLOW_DOWN once per second) or
//    disconnect it.
//
// Fail open everywhere: Redis calls time out after timeoutMs, and every entry
// point is wrapped so an exception in Kairo never reaches CypherFy's handlers.

import { AsyncLocalStorage } from 'node:async_hooks';

import { KEYS, MAX_SOCKET_EVENT_NAMES } from './schema/index.js';
import { withTimeout } from './redis.service.js';

const RULE_ID = /^R[0-9][a-z]?$/;
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_:.-]{0,31}$/;
const ROOM_EVENTS = new Set(['join_room', 'knock']);
const ROOM_MISS_CODES = new Set(['ROOM_NOT_FOUND', 'INVALID_CODE']);
const ERROR_EVENT = 'error'; // CypherFy's SOCKET_EVENTS.ERROR
const MAX_CODE_LENGTH = 64;

/** Client-chosen event names: identifier-like or folded into "other". */
export const safeEventName = (name) => (typeof name === 'string' && EVENT_NAME.test(name) ? name : 'other');

const parseKeyValue = (value) => {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

const clientOf = (handshake) => {
  const c = String(handshake?.auth?.client ?? handshake?.headers?.['x-client'] ?? '').toLowerCase();
  return c === 'web' || c === 'flutter' ? c : 'unknown'; // informational only, never an exemption
};

export const createSocketLayer = ({ io, redis, emitter, hasher, env, inst, timeoutMs, log, now = Date.now, flushMs = 1000, autoFlush = true }) => {
  const enforce = env !== 'production'; // production is shadow-only (ARCH D10)
  const states = new Map(); // socket.id → per-connection state, deleted on disconnect
  const packetContext = new AsyncLocalStorage(); // { socketId, event, codeHash } of the packet being handled

  const srcOf = (socket) => {
    const src = {
      ipHash: hasher.ip(socket.handshake?.address ?? socket.conn?.remoteAddress ?? 'unknown'),
      client: clientOf(socket.handshake),
      authed: Boolean(socket.data?.userId),
      socketId: socket.id,
    };
    if (socket.data?.userId) src.userHash = hasher.user(socket.data.userId);
    return src;
  };

  const emit = (type, src, extra) => emitter.emit({ ts: now(), type, env, inst, src, ...extra });

  // ---- 1. Guard ----------------------------------------------------------
  const guard = (socket, next) => {
    let done = false;
    const proceed = (err) => {
      if (!done) {
        done = true;
        next(err);
      }
    };
    try {
      if (!enforce || socket.data?.userId) return proceed();
      const src = srcOf(socket);
      withTimeout(redis.mget(KEYS.allow(src.ipHash), KEYS.block('socket', src.ipHash), KEYS.killswitch), timeoutMs).then(
        ([allow, block, killswitch]) => {
          try {
            if (allow || killswitch || !block) return proceed();
            const info = parseKeyValue(block);
            const rule = RULE_ID.test(info.rule) ? info.rule : null;
            const retryAfter = Math.max(1, Math.ceil(((Number(info.expiresAt) || now() + 60_000) - now()) / 1000));
            if (rule) emit('http.denied', src, { http: { scope: 'socket', rule } });
            const err = new Error('KAIRO_BLOCKED');
            err.data = { code: 'KAIRO_BLOCKED', message: 'Temporarily blocked', retryAfter };
            proceed(err);
          } catch (err) {
            log('kairo.hook_error', { where: 'socket_guard', error: err?.message?.slice(0, 120) });
            proceed();
          }
        },
        () => {
          log('kairo.redis_unavailable', { op: 'socket_guard', failOpen: true });
          proceed();
        }
      );
    } catch (err) {
      log('kairo.hook_error', { where: 'socket_guard', error: err?.message?.slice(0, 120) });
      proceed();
    }
  };

  // ---- 2. Observe ----------------------------------------------------------
  const count = (state, name) => {
    let key = safeEventName(name);
    if (!state.counts.has(key) && state.counts.size >= MAX_SOCKET_EVENT_NAMES - 1) key = 'other';
    state.counts.set(key, (state.counts.get(key) ?? 0) + 1);
    state.total += 1;
  };

  /** Token bucket while throttled → true if this packet may pass. */
  const takeToken = (state) => {
    const b = state.bucket;
    if (!b) return true;
    const t = now();
    if (t >= b.until) {
      state.bucket = null;
      return true;
    }
    b.tokens = Math.min(b.maxPerSec, b.tokens + ((t - b.refilledAt) * b.maxPerSec) / 1000);
    b.refilledAt = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    if (t - state.lastSlowDownAt >= 1000) {
      state.lastSlowDownAt = t;
      state.rawEmit(ERROR_EVENT, { code: 'SLOW_DOWN', message: 'Slow down: too many events' });
    }
    return false;
  };

  const onPacket = (state, packet, next) => {
    let pass = true;
    let context = null;
    try {
      const [name, payload] = packet;
      count(state, name);
      context = { socketId: state.socket.id, event: safeEventName(name), codeHash: null };
      if (ROOM_EVENTS.has(name)) {
        // Hash the code at once and keep only the hash (in CypherFy the code is the room key).
        const code = payload && typeof payload.code === 'string' && payload.code.length <= MAX_CODE_LENGTH ? payload.code : '';
        context.codeHash = hasher.roomCode(code);
      }
      pass = takeToken(state);
    } catch (err) {
      log('kairo.hook_error', { where: 'socket_use', error: err?.message?.slice(0, 120) });
    }
    if (!pass) return; // a dropped packet simply never reaches CypherFy's handler
    if (context) packetContext.run(context, next);
    else next();
  };

  const onEmit = (state, event, payload) => {
    const ctx = packetContext.getStore();
    if (!ctx || ctx.socketId !== state.socket.id) return; // not a reply to this socket's own packet
    if (event === ERROR_EVENT) {
      const code = payload?.code;
      if (code === 'BAD_PAYLOAD') {
        emit('socket.invalid_payload', state.src, { sock: { event: ctx.event } });
      } else if (ROOM_MISS_CODES.has(code) && ROOM_EVENTS.has(ctx.event) && ctx.codeHash) {
        emit('room.join.invalid', state.src, { room: { codeHash: ctx.codeHash, kind: 'ephemeral', via: 'socket', error: code } });
      }
    } else if (event === 'room_joined' && ctx.event === 'join_room' && ctx.codeHash) {
      emit('room.join.success', state.src, { room: { codeHash: ctx.codeHash, kind: 'ephemeral', via: 'socket' } });
    }
  };

  const onConnection = (socket) => {
    try {
      const rawEmit = socket.emit.bind(socket);
      const state = {
        src: srcOf(socket),
        counts: new Map(),
        total: 0,
        bucket: null,
        lastSlowDownAt: -Infinity,
        rawEmit, // Kairo's own replies go out unobserved
        socket,
      };
      states.set(socket.id, state);

      socket.use((packet, next) => onPacket(state, packet, next));
      socket.emit = function kairoEmit(event, ...args) {
        try {
          onEmit(state, event, args[0]);
        } catch (err) {
          log('kairo.hook_error', { where: 'socket_emit', error: err?.message?.slice(0, 120) });
        }
        return rawEmit(event, ...args);
      };
      socket.on('disconnect', () => {
        try {
          flushOne(state);
          states.delete(socket.id);
          emit('socket.disconnect', state.src);
        } catch {
          /* never throw into Socket.io */
        }
      });
      emit('socket.connect', state.src);
    } catch (err) {
      log('kairo.hook_error', { where: 'socket_connect', error: err?.message?.slice(0, 120) });
    }
  };

  // One socket.rate per socket per second that sent anything (ARCH §5.2).
  const flushOne = (state) => {
    if (!state.total) return;
    const counts = Object.fromEntries(state.counts);
    const total = state.total;
    state.counts = new Map();
    state.total = 0;
    emit('socket.rate', state.src, { sock: { counts, total, windowMs: flushMs } });
  };
  const flush = () => {
    for (const state of states.values()) {
      try {
        flushOne(state);
      } catch (err) {
        log('kairo.hook_error', { where: 'socket_flush', error: err?.message?.slice(0, 120) });
      }
    }
  };
  const timer = autoFlush ? setInterval(flush, flushMs) : null; // tests flush by hand
  timer?.unref?.();

  // ---- 3. Obey -------------------------------------------------------------
  return {
    guard,
    onConnection,
    flush,
    stateOf: (socketId) => states.get(socketId) ?? null,
    /** → the socket's src if it lives on this instance, else null. */
    throttle(socketId, maxPerSec, ttlMs) {
      const state = states.get(socketId);
      if (!state) return null;
      // Replaced, not stacked (ARCH §7.3).
      state.bucket = { maxPerSec, until: now() + ttlMs, tokens: maxPerSec, refilledAt: now() };
      return state.src;
    },
    disconnect(socketId) {
      const state = states.get(socketId);
      const socket = state?.socket ?? io?.of('/').sockets.get(socketId);
      if (!socket) return null;
      const src = state?.src ?? srcOf(socket);
      socket.disconnect(true);
      return src;
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
};

/** Hook the layer into an io server; a pass-through until getLayer() returns one. */
export const attachSocketLayer = (io, getLayer) => {
  io.use((socket, next) => {
    const layer = getLayer();
    return layer ? layer.guard(socket, next) : next();
  });
  // Registered before CypherFy's own io.on('connection'), so the packet
  // middleware and the emit wrapper are in place before its handlers run.
  io.on('connection', (socket) => getLayer()?.onConnection(socket));
};

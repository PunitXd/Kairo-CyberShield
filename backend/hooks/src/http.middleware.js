// Express middleware: classify → guard → observe.
//
// 1. Classify the request BEFORE routing, from the method and the normalised
//    path. Express matches routes case-insensitively and ignores a trailing
//    slash, so we lowercase and strip it too, or `/Auth/LOGIN/` would reach the
//    login handler without passing the guard. Raw identifiers (IP, email, room
//    code) are hashed here and the raw values are not kept.
// 2. Guard (ARCH §4.2): one MGET for allow / block / throttle / killswitch.
//    Block → 403, throttle → token gate or 429, both with X-Kairo-Rule and an
//    http.denied event. Any Redis error or timeout → next() (fail open).
// 3. Observe: on res 'finish', emit auth.fail / auth.success / room.join.invalid.
//
// Every entry point is wrapped so an exception in Kairo can never break a
// CypherFy request: it logs and calls next().

import { KEYS } from './schema/index.js';
import { withTimeout } from './redis.service.js';

const AUTH_PREFIX = '/api/v1/auth/';
const ROOMS_PREFIX = '/api/v1/rooms/';
const RULE_ID = /^R[0-9][a-z]?$/;
const THROTTLE_WINDOW_MS = 5000;

// POST /api/v1/auth/<path> → event route (null = guarded, no event).
// refresh-token, logout and change-password are deliberately absent: a logged-in
// user behind a blocked NAT IP must keep their session (ARCH §7.4).
const AUTH_ENDPOINTS = {
  login: 'login',
  register: 'register',
  'verify-email': 'verify_email',
  'resend-verification': null,
  firebase: 'firebase',
  'forgot-password': 'forgot_password',
  'verify-otp': 'verify_otp',
  'reset-password': 'reset_password',
};

const normalizePath = (p) => String(p || '/').toLowerCase().replace(/\/+$/, '') || '/';

/**
 * @returns {{scope: 'auth', route: string|null} | {scope: 'room_join', rawCode: string} | null}
 */
export const classifyRequest = (method, rawPath) => {
  const path = normalizePath(rawPath);
  if (method === 'POST' && path.startsWith(AUTH_PREFIX)) {
    const endpoint = path.slice(AUTH_PREFIX.length);
    if (Object.hasOwn(AUTH_ENDPOINTS, endpoint)) return { scope: 'auth', route: AUTH_ENDPOINTS[endpoint] };
    return null;
  }
  if ((method === 'GET' || method === 'HEAD') && path.startsWith(ROOMS_PREFIX)) {
    const segment = path.slice(ROOMS_PREFIX.length);
    if (segment && !segment.includes('/') && segment !== 'permanent') {
      // Lowercased here; hasher.roomCode() uppercases, matching CypherFy's lookup.
      return { scope: 'room_join', rawCode: segment };
    }
  }
  return null;
};

const parseKeyValue = (value) => {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

const clientOf = (req) => {
  const c = String(req.get?.('x-client') ?? '').toLowerCase();
  return c === 'web' || c === 'flutter' ? c : 'unknown'; // informational only, never an exemption
};

export const createHttpMiddleware = ({ redis, emitter, hasher, env, inst, timeoutMs, log, now = Date.now }) => {
  const enforce = env !== 'production'; // production is shadow-only (ARCH D10)

  const baseEvent = (type, src) => ({ ts: now(), type, env, inst, src });

  const srcOf = (req, ipHash) => {
    const src = { ipHash, client: clientOf(req), authed: Boolean(req.user) };
    if (req.user?._id) src.userHash = hasher.user(req.user._id);
    return src;
  };

  // → { action: 'pass' } | { action: 'block'|'throttle', info }
  const decide = async (scope, ipHash) => {
    const [allow, block, throttle, killswitch] = await withTimeout(
      redis.mget(KEYS.allow(ipHash), KEYS.block(scope, ipHash), KEYS.throttle(scope, ipHash), KEYS.killswitch),
      timeoutMs
    );
    if (allow || killswitch) return { action: 'pass' };
    if (block) return { action: 'block', info: parseKeyValue(block) };
    if (throttle) {
      const gate = await withTimeout(
        redis.set(KEYS.tokenGate(scope, ipHash), '1', 'PX', THROTTLE_WINDOW_MS, 'NX'),
        timeoutMs
      );
      return gate === 'OK' ? { action: 'pass' } : { action: 'throttle', info: parseKeyValue(throttle) };
    }
    return { action: 'pass' };
  };

  const deny = (req, res, scope, ipHash, decision) => {
    const rule = RULE_ID.test(decision.info.rule) ? decision.info.rule : null;
    const isBlock = decision.action === 'block';
    const retryAfter = isBlock
      ? Math.max(1, Math.ceil(((Number(decision.info.expiresAt) || now() + 60_000) - now()) / 1000))
      : Math.ceil(THROTTLE_WINDOW_MS / 1000);

    res.set('Retry-After', String(retryAfter));
    if (rule) res.set('X-Kairo-Rule', rule);
    res.status(isBlock ? 403 : 429).json({
      success: false,
      message: isBlock ? 'Temporarily blocked' : `Too many attempts. Please try again in ${retryAfter}s.`,
      retryAfter,
    });

    if (rule) emitter.emit({ ...baseEvent('http.denied', srcOf(req, ipHash)), http: { scope, rule } });
    else log('kairo.key_without_rule', { scope });
  };

  const observe = (req, res, kind, ipHash, accountHash, codeHash) => {
    res.once('finish', () => {
      try {
        const status = res.statusCode;
        if (kind.scope === 'auth') {
          if (!kind.route) return;
          const type = status >= 200 && status < 300 ? 'auth.success' : [400, 401, 403].includes(status) ? 'auth.fail' : null;
          if (!type) return; // 429 from CypherFy's own limiter, 5xx: not an auth signal here
          const auth = { route: kind.route, status };
          if (accountHash) auth.accountHash = accountHash;
          emitter.emit({ ...baseEvent(type, srcOf(req, ipHash)), auth });
        } else if (status === 404) {
          emitter.emit({
            ...baseEvent('room.join.invalid', srcOf(req, ipHash)),
            room: { codeHash, kind: 'ephemeral', via: 'http' },
          });
        }
      } catch (err) {
        log('kairo.hook_error', { where: 'finish', error: err?.message?.slice(0, 120) });
      }
    });
  };

  return function kairoHttp(req, res, next) {
    let called = false;
    const proceed = () => {
      if (!called) {
        called = true;
        next();
      }
    };

    try {
      const kind = classifyRequest(req.method, req.path);
      if (!kind) return proceed();

      // Hash now; keep only hashes past this point.
      const ipHash = hasher.ip(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
      const email = kind.scope === 'auth' && typeof req.body?.email === 'string' ? req.body.email : null;
      const accountHash = email && email.length <= 254 ? hasher.account(email) : undefined;
      const codeHash = kind.scope === 'room_join' ? hasher.roomCode(kind.rawCode) : undefined;
      const { scope } = kind;

      const allow = () => {
        observe(req, res, kind, ipHash, accountHash, codeHash);
        proceed();
      };

      if (!enforce) return allow();

      decide(scope, ipHash).then(
        (decision) => {
          try {
            if (decision.action === 'pass') return allow();
            deny(req, res, scope, ipHash, decision);
          } catch (err) {
            log('kairo.hook_error', { where: 'deny', error: err?.message?.slice(0, 120) });
            proceed();
          }
        },
        () => {
          log('kairo.redis_unavailable', { op: 'guard', failOpen: true });
          allow();
        }
      );
    } catch (err) {
      log('kairo.hook_error', { where: 'classify', error: err?.message?.slice(0, 120) });
      proceed();
    }
  };
};

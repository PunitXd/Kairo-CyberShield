import { fileURLToPath } from 'node:url';

import { loadRulesConfig } from '../src/defender.config.js';
import { WindowStore } from '../src/utils/WindowStore.js';
import { createRuleRunner } from '../src/services/ruleRunner.service.js';
import { rules } from '../src/rules/index.js';

export const CONFIG = loadRulesConfig(fileURLToPath(new URL('../config/rules.json', import.meta.url)));

export const IP_A = '3e9a5b0c1d2e44c1';
export const IP_B = '77b0e2aa91c0d3e2';
export const T0 = 1_760_800_000_000;

/** Deep-copied config with overrides per rule, e.g. withRules({ R1a: { mode: 'off' } }). */
export const withRules = (overrides = {}) => {
  const cfg = structuredClone(CONFIG);
  for (const [id, o] of Object.entries(overrides)) Object.assign(cfg.rules[id], o);
  return cfg;
};

let n = 0;
export const authFail = ({ ts, ip = IP_A, route = 'login', account = (n++ % 20).toString(16).padStart(16, 'a') } = {}) => ({
  ts,
  type: 'auth.fail',
  env: 'staging',
  inst: 'test-1',
  src: { ipHash: ip, client: 'unknown', authed: false },
  auth: { route, status: 401, accountHash: account },
});

let m = 0;
export const roomMiss = ({ ts, ip = IP_A, code = (m++).toString(16).padStart(16, 'c') } = {}) => ({
  ts,
  type: 'room.join.invalid',
  env: 'staging',
  inst: 'test-1',
  src: { ipHash: ip, client: 'unknown', authed: false },
  room: { codeHash: code, kind: 'ephemeral', via: 'http' },
});

const onSocket = (type, { ts, ip = IP_A, socketId = 'sockA', userHash, sessionKey }) => ({
  ts,
  type,
  env: 'staging',
  inst: 'test-1',
  src: { ipHash: ip, client: 'web', authed: Boolean(userHash), socketId, ...(userHash ? { userHash } : {}), ...(sessionKey ? { sessionKey } : {}) },
});

/** One socket.rate summary (one second of packets from one socket). */
export const socketRate = ({ counts = { send_message: 10 }, ...rest }) => ({
  ...onSocket('socket.rate', rest),
  sock: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), windowMs: 1000 },
});
export const socketConnect = (opts) => onSocket('socket.connect', opts);
export const badPayload = ({ event = 'send_message', ...rest }) => ({ ...onSocket('socket.invalid_payload', rest), sock: { event } });
export const socketRoomMiss = ({ code = (m++).toString(16).padStart(16, 'c'), ...rest }) => ({
  ...onSocket('room.join.invalid', rest),
  room: { codeHash: code, kind: 'ephemeral', via: 'socket', error: 'ROOM_NOT_FOUND' },
});

/** A runner over the real rules that records decisions instead of acting. */
export const recordingRunner = (config = CONFIG) => {
  const decisions = [];
  const runner = createRuleRunner({
    rules,
    windows: new WindowStore(),
    getConfig: () => config,
    onDecision: ({ rule, subject, decision, event }) => decisions.push({ rule: rule.id, subject, decision, ts: event.ts }),
  });
  return { runner, decisions };
};

/** Feed events in order. */
export const feed = async (runner, events) => {
  for (const e of events) await runner.handle(e);
};

/** In-memory Redis with a controllable clock for the commands the actions use. */
export const fakeRedis = (clock) => {
  const kv = new Map(); // key -> { value, expiresAt }
  const zsets = new Map(); // key -> Map(member -> score)
  const live = (key) => {
    const e = kv.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= clock.now) {
      kv.delete(key);
      return undefined;
    }
    return e;
  };
  const zset = (key) => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key);
  };
  const api = {
    kv,
    zsets,
    get: async (key) => live(key)?.value ?? null,
    del: async (...keys) => keys.filter((k) => live(k) && kv.delete(k)).length,
    zrem: async (key, member) => (zset(key).delete(member) ? 1 : 0),
    exists: async (key) => (live(key) ? 1 : 0),
    set: async (key, value, ...opts) => {
      if (opts.includes('NX') && live(key)) return null;
      const px = opts.indexOf('PX');
      kv.set(key, { value: String(value), expiresAt: px > -1 ? clock.now + Number(opts[px + 1]) : null });
      return 'OK';
    },
    pttl: async (key) => {
      const e = live(key);
      if (!e) return -2;
      return e.expiresAt === null ? -1 : e.expiresAt - clock.now;
    },
    pexpire: async (key, ms) => {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = clock.now + ms;
      return 1;
    },
    incr: async (key) => {
      const e = live(key);
      const next = (e ? Number(e.value) : 0) + 1;
      kv.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
      return next;
    },
    zadd: async (key, score, member) => {
      zset(key).set(member, Number(score));
      return 1;
    },
    zremrangebyscore: async (key, min, max) => {
      const z = zset(key);
      let removed = 0;
      for (const [m, s] of z) if ((min === '-inf' || s >= min) && s <= Number(max)) z.delete(m) && removed++;
      return removed;
    },
    zcard: async (key) => zset(key).size,
    published: [],
    publish: async (channel, message) => {
      api.published.push([channel, JSON.parse(message)]);
      return 1;
    },
  };
  // pipeline() / multi(): queue chained calls, run them in order on exec(),
  // resolve to ioredis's [[err, result], ...] shape.
  const batch = () => {
    const ops = [];
    const chain = new Proxy(
      {},
      {
        get: (_t, name) =>
          name === 'exec'
            ? async () => {
                const out = [];
                for (const [fn, args] of ops) out.push([null, await api[fn](...args)]);
                return out;
              }
            : (...args) => {
                ops.push([name, args]);
                return chain;
              },
      }
    );
    return chain;
  };
  api.pipeline = batch;
  api.multi = batch;
  return api;
};

export const silentLog = { info() {}, warn() {}, error() {}, fatal() {} };

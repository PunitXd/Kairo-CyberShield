import { EventEmitter } from 'node:events';

import { createHasher } from '../src/schema/index.js';

// Low-entropy fixture so secret scanners don't mistake it for a real key.
export const hasher = createHasher('fixture'.repeat(6));

export const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** In-memory stand-in for the ioredis calls the hooks make. */
export const fakeRedis = ({ mode = 'ok' } = {}) => {
  const store = new Map();
  const xadds = [];
  const calls = [];
  const gate = (fn) => (...args) => {
    calls.push(args[0]);
    if (mode === 'down') return Promise.reject(new Error('connection refused'));
    if (mode === 'hang') return new Promise(() => {});
    return Promise.resolve(fn(...args));
  };
  return {
    store,
    xadds,
    calls,
    mget: gate((...keys) => keys.map((k) => store.get(k) ?? null)),
    get: gate((k) => store.get(k) ?? null),
    del: gate((...keys) => keys.filter((k) => store.delete(k)).length),
    set: gate((key, value, ...opts) => {
      if (opts.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    xadd: gate((...args) => {
      xadds.push(args);
      return '1-0';
    }),
  };
};

/** Parse the events written by XADD (fields: ... '*', 'v', '1', 'e', json). */
export const writtenEvents = (redis) => redis.xadds.map((args) => JSON.parse(args[args.indexOf('e') + 1]));

export const fakeReq = ({ method = 'POST', path = '/api/v1/auth/login', ip = '::ffff:172.18.0.5', body = {}, headers = {}, user } = {}) => ({
  method,
  path,
  ip,
  body,
  user,
  get: (name) => headers[name.toLowerCase()],
});

export const fakeRes = () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.set = (k, v) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    res.emit('finish');
    return res;
  };
  /** Simulate CypherFy's route answering with `status`. */
  res.finishWith = (status) => {
    res.statusCode = status;
    res.emit('finish');
  };
  return res;
};

/** Run the middleware; resolves with whether next() was called. */
export const run = async (mw, req, res) => {
  let nextCalls = 0;
  mw(req, res, () => {
    nextCalls++;
  });
  await flush();
  return nextCalls;
};

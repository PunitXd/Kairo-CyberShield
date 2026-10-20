// Fakes for the console API tests: just enough Redis (scan, pipeline, ping,
// get) and Mongo (find chain, countDocuments, findOne, ping) to drive the
// controllers, plus a raw HTTP helper that can send any Host / Origin header
// (fetch forbids setting Host).

import { request } from 'node:http';

export const fakeRedis = ({ keys = {}, down = false, stream = [] } = {}) => {
  // keys: { 'kairo:block:auth:<hash>': { value: '{...}', pttl: 299000 } }
  const fail = () => Promise.reject(new Error('redis down'));
  const matches = (pattern, k) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(k);
  return {
    keys,
    ping: () => (down ? fail() : Promise.resolve('PONG')),
    // stream: [[id, fields], ...] oldest first, like XRANGE; XREVRANGE returns newest first.
    xrevrange: (_key, _end, _start, _count, n) => (down ? fail() : Promise.resolve([...stream].reverse().slice(0, Number(n)))),
    get: (k) => (down ? fail() : Promise.resolve(keys[k]?.value ?? null)),
    mget: (...ks) => (down ? fail() : Promise.resolve(ks.map((k) => keys[k]?.value ?? null))),
    scan: (_cursor, _m, pattern) =>
      down ? fail() : Promise.resolve(['0', Object.keys(keys).filter((k) => matches(pattern, k))]),
    pipeline() {
      const ops = [];
      const pipe = {
        get: (k) => (ops.push([null, keys[k]?.value ?? null]), pipe),
        pttl: (k) => (ops.push([null, keys[k] ? keys[k].pttl : -2]), pipe),
        exec: () => (down ? fail() : Promise.resolve(ops)),
      };
      return pipe;
    },
  };
};

const cursorOf = (docs) => {
  let rows = [...docs];
  const cur = {
    sort: (spec) => {
      const [[field, dir]] = Object.entries(spec);
      rows.sort((a, b) => (a[field] < b[field] ? -dir : a[field] > b[field] ? dir : 0));
      return cur;
    },
    limit: (n) => ((rows = rows.slice(0, n)), cur),
    toArray: async () => rows,
  };
  return cur;
};

/** Applies the subset of Mongo filters the controllers use: equality, $gte, $lt, $in. */
const matchesFilter = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$gte' in cond && !(v >= cond.$gte)) return false;
      if ('$lt' in cond && !(v < cond.$lt)) return false;
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      return true;
    }
    return v === cond;
  });

const fakeCollection = (docs) => ({
  docs,
  find: (filter = {}) => cursorOf(docs.filter((d) => matchesFilter(d, filter))),
  countDocuments: async (filter = {}) => docs.filter((d) => matchesFilter(d, filter)).length,
  findOne: async (filter = {}) => docs.find((d) => matchesFilter(d, filter)) ?? null,
});

export const fakeMongo = ({ incidents = [], actions = [], pipelineRuns = [], down = false } = {}) => ({
  db: { command: () => (down ? Promise.reject(new Error('mongo down')) : Promise.resolve({ ok: 1 })) },
  incidents: fakeCollection(incidents),
  actions: fakeCollection(actions),
  pipelineRuns: fakeCollection(pipelineRuns),
});

/** GET with arbitrary headers; resolves { status, headers, body (parsed JSON or text) }. */
export const rawGet = (port, path, headers = {}) => rawRequest(port, 'GET', path, { headers });

/** Any method, arbitrary headers, optional string body. */
export const rawRequest = (port, method, path, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let body = data;
        try {
          body = JSON.parse(data);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

/** Listen on an ephemeral loopback port; resolves the port. */
export const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

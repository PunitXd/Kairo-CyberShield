// Configuration: environment + defender/config/rules.json (ARCH §6.2).
//
// Every threshold lives in rules.json; code only holds defaults for tests.
// The file is validated with a strict zod schema at load and on SIGHUP; an
// invalid reload keeps the previous config and logs `config.reload_failed`.
// Mode changes from the console (PATCH /api/rules/:id) go through replace(),
// in memory: the container is read-only, so rules.json is never rewritten
// and a Defender restart (or demo:reset) returns to the file. Every version
// is snapshotted in Mongo config_versions by the rule service.

import { readFileSync } from 'node:fs';

import { rulesConfigSchema } from './validators/rulesConfig.schema.js';

export const loadRulesConfig = (path) => rulesConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

/** Holds the live config; reload() swaps it only if the new file is valid. */
export const createConfigStore = (path, log) => {
  let current = loadRulesConfig(path);
  return {
    path,
    get: () => current,
    /** The file as it is now (validated), or null if it is invalid. */
    readFile() {
      try {
        return loadRulesConfig(path);
      } catch (err) {
        log.error({ msg: 'config.reload_failed', configVersion: current.version, error: err.message.slice(0, 300) });
        return null;
      }
    },
    /** Swap in a whole config; validated first, so a bad one throws and changes nothing. */
    replace(next) {
      current = rulesConfigSchema.parse(next);
      return current;
    },
    reload() {
      const next = this.readFile();
      if (!next) return;
      current = next;
      log.info({ msg: 'config.reloaded', configVersion: current.version });
    },
  };
};

const LOCAL_HOST = /^(mongo|localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

/** Hosts in a mongodb:// URI (handles replica-set host lists); null for mongodb+srv or garbage. */
export const getMongoHosts = (uri) => {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(uri));
  if (!m) return null;
  return m[1].split(',').map((h) => h.replace(/:\d+$/, ''));
};

export const isLocalMongo = (uri) => {
  const hosts = getMongoHosts(uri);
  return Boolean(hosts?.length) && hosts.every((h) => LOCAL_HOST.test(h));
};

const GITHUB_REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/**
 * GitHub poller settings (ARCH §4.4). No GITHUB_REPO → poller off. The token
 * is optional (without it the poller shows pass/fail only) and is never logged.
 */
export const readGithubEnv = (env = process.env) => {
  const repo = env.GITHUB_REPO || null;
  const dotsOnly = repo?.split('/').some((s) => /^\.+$/.test(s)); // "../x" would walk the API path
  if (repo && (!GITHUB_REPO.test(repo) || dotsOnly)) throw new Error('GITHUB_REPO must look like owner/name');
  const pollMs = Number(env.GITHUB_POLL_MS);
  return {
    repo,
    token: env.GITHUB_TOKEN || null,
    pollMs: Number.isFinite(pollMs) && pollMs >= 5000 ? pollMs : 15_000,
  };
};

export const readEnv = (env = process.env) => {
  const cfg = {
    env: env.KAIRO_ENV,
    redisUrl: env.KAIRO_REDIS_URL,
    mongoUri: env.KAIRO_MONGO_URI,
    rulesPath: env.KAIRO_RULES_PATH || new URL('../config/rules.json', import.meta.url).pathname,
    logLevel: env.LOG_LEVEL || 'info',
    staleEventMs: Number(env.KAIRO_STALE_EVENT_MS) > 0 ? Number(env.KAIRO_STALE_EVENT_MS) : null,
    port: Number(env.KAIRO_PORT) > 0 ? Number(env.KAIRO_PORT) : 7070,
    // Loopback by default. Inside the container it must be 0.0.0.0 to be
    // reachable through the published port, which Compose binds to the host's
    // 127.0.0.1 only, so the console is still never on the LAN.
    bindHost: env.KAIRO_BIND_HOST || '127.0.0.1',
    // Optional here: only used to hash the operator's IP in the audit log.
    hashSecret: env.KAIRO_HASH_SECRET || null,
    github: readGithubEnv(env),
  };
  const missing = ['env', 'redisUrl', 'mongoUri'].filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`missing environment: ${missing.join(', ')}`);
  if (!['staging', 'production', 'local'].includes(cfg.env)) throw new Error('KAIRO_ENV must be staging, production or local');
  // ARCH §11.1: the demo stack must never touch production data.
  if (cfg.env === 'staging' && !isLocalMongo(cfg.mongoUri)) {
    throw new Error('refusing to start: KAIRO_ENV=staging but KAIRO_MONGO_URI is not a local host');
  }
  return cfg;
};

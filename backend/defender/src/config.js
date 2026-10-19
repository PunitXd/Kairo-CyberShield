// Configuration: environment + defender/config/rules.json (ARCH §6.2).
//
// Every threshold lives in rules.json; code only holds defaults for tests.
// The file is validated with a strict zod schema at load and on SIGHUP; an
// invalid reload keeps the previous config and logs `config.reload_failed`.

import { readFileSync } from 'node:fs';
import { z } from 'zod';

const posInt = z.number().int().positive();
const mode = z.enum(['enforce', 'shadow', 'off']);
const HOUR_MS = 3_600_000;

export const RulesConfig = z.strictObject({
  version: posInt,
  global: z.strictObject({
    maxBlockMs: posInt.max(HOUR_MS), // no automatic block exceeds 60 min (PRD F3)
    ladderMs: z.array(posInt).min(1),
    strikesTtlMs: posInt,
    activeBlockCap: posInt,
    staleEventMs: posInt,
  }),
  rules: z.strictObject({
    R1a: z.strictObject({ mode, threshold: posInt, windowMs: posInt, ttlMs: posInt }),
    R1b: z.strictObject({ mode, threshold: posInt, windowMs: posInt, softFiringsThreshold: posInt, softFiringsWindowMs: posInt }),
    R2a: z.strictObject({ mode, threshold: posInt, windowMs: posInt }),
  }),
});

export const loadRulesConfig = (path) => RulesConfig.parse(JSON.parse(readFileSync(path, 'utf8')));

/** Holds the live config; reload() swaps it only if the new file is valid. */
export const createConfigStore = (path, log) => {
  let current = loadRulesConfig(path);
  return {
    get: () => current,
    reload() {
      try {
        current = loadRulesConfig(path);
        log.info({ msg: 'config.reloaded', configVersion: current.version });
      } catch (err) {
        log.error({ msg: 'config.reload_failed', configVersion: current.version, error: err.message.slice(0, 300) });
      }
    },
  };
};

const LOCAL_HOST = /^(mongo|localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

/** Hosts in a mongodb:// URI (handles replica-set host lists); null for mongodb+srv or garbage. */
export const mongoHosts = (uri) => {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(String(uri));
  if (!m) return null;
  return m[1].split(',').map((h) => h.replace(/:\d+$/, ''));
};

export const isLocalMongo = (uri) => {
  const hosts = mongoHosts(uri);
  return Boolean(hosts?.length) && hosts.every((h) => LOCAL_HOST.test(h));
};

export const readEnv = (env = process.env) => {
  const cfg = {
    env: env.KAIRO_ENV,
    redisUrl: env.KAIRO_REDIS_URL,
    mongoUri: env.KAIRO_MONGO_URI,
    rulesPath: env.KAIRO_RULES_PATH || new URL('../config/rules.json', import.meta.url).pathname,
    logLevel: env.LOG_LEVEL || 'info',
    staleEventMs: Number(env.KAIRO_STALE_EVENT_MS) > 0 ? Number(env.KAIRO_STALE_EVENT_MS) : null,
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

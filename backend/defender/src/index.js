// Defender boot (ARCH §15): config → redis → mongo → engine → api + realtime.
// The dashboard's static build joins the same server on Oct 20 (task 5).

import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import Redis from 'ioredis';
import { createHasher } from 'kairo-schema';

import { createConfigStore, readEnv } from './defender.config.js';
import { createLogger } from './utils/logger.js';
import connectDB from './db/index.js';
import { WindowStore } from './utils/WindowStore.js';
import { createRuleRunner } from './services/ruleRunner.service.js';
import { createConsumer } from './services/consumer.service.js';
import { createRemediation } from './services/remediation.service.js';
import { createBlockWatcher } from './services/block.service.js';
import { getSystemStatus } from './services/health.service.js';
import { createRealtime } from './services/realtime.service.js';
import { createUnblockService } from './services/unblock.service.js';
import { createKillSwitchService } from './services/killswitch.service.js';
import { createGithubPoller } from './pollers/github.poller.js';
import { createApp } from './app.js';
import { rules } from './rules/index.js';

const SWEEP_MS = 30_000;

const boot = async () => {
  let env;
  try {
    env = readEnv();
  } catch (err) {
    createLogger({ env: process.env.KAIRO_ENV }).fatal({ msg: 'defender.config_invalid', error: err.message });
    process.exit(1);
  }
  const log = createLogger({ level: env.logLevel, env: env.env });

  let configStore;
  try {
    configStore = createConfigStore(env.rulesPath, log);
  } catch (err) {
    log.fatal({ msg: 'config.load_failed', path: env.rulesPath, error: err.message.slice(0, 300) });
    process.exit(1);
  }
  process.on('SIGHUP', () => configStore.reload());

  const redis = new Redis(env.redisUrl);
  const consumerRedis = new Redis(env.redisUrl); // XREADGROUP BLOCK holds its connection
  for (const [name, client] of [['redis', redis], ['redis.consumer', consumerRedis]]) {
    client.on('error', (err) => log.warn({ msg: `${name}.error`, error: err.message }));
  }

  const mongo = await connectDB(env.mongoUri);
  const bus = new EventEmitter(); // in-process: remediation / block watcher → realtime

  const windows = new WindowStore();
  setInterval(() => windows.sweep(Date.now()), SWEEP_MS).unref();

  const remediation = createRemediation({ redis, mongo, env: env.env, log, bus });
  const runner = createRuleRunner({
    rules,
    windows,
    getConfig: configStore.get,
    onDecision: (d) => remediation.handle({ ...d, rules }),
    log,
  });
  const consumer = createConsumer({
    redis: consumerRedis,
    runner,
    log,
    getStaleMs: () => env.staleEventMs ?? configStore.get().global.staleEventMs,
  });

  // --- Console API + realtime ---
  const getRules = () => {
    const cfg = configStore.get();
    return rules.map((r) => ({ id: r.id, mode: cfg.rules[r.id]?.mode ?? 'off' }));
  };
  let hasher = null;
  try {
    hasher = env.hashSecret ? createHasher(env.hashSecret) : null;
  } catch {
    log.warn({ msg: 'audit.no_hasher', reason: 'KAIRO_HASH_SECRET missing or short; operator IPs are not recorded' });
  }
  const unblock = createUnblockService({ redis, mongo, bus, log, hasher });
  const killSwitch = createKillSwitchService({ redis, mongo, bus, log, hasher });
  // GitHub Actions poller (ARCH §4.4); off when GITHUB_REPO is unset.
  const pipelinePoller = env.github.repo
    ? createGithubPoller({ repo: env.github.repo, token: env.github.token, pollMs: env.github.pollMs, mongo, bus, log })
    : null;
  if (!pipelinePoller) log.warn({ msg: 'pipeline.poller_off', reason: 'GITHUB_REPO is not set' });
  const deps = {
    redis,
    mongo,
    env: env.env,
    log,
    getConsumerStats: () => consumer.stats,
    getRules,
    unblock,
    killSwitch,
    getConfig: configStore.get,
    getPipelineSync: pipelinePoller ? pipelinePoller.getSync : null,
  };
  const httpServer = createServer(createApp(deps));
  const realtime = createRealtime({ httpServer, bus, log, getStatus: () => getSystemStatus(deps) });
  const blockWatcher = createBlockWatcher({ redis, bus, log });
  await blockWatcher.start();
  await new Promise((resolve) => httpServer.listen(env.port, env.bindHost, resolve));
  await pipelinePoller?.start();

  const shutdown = async (signal) => {
    log.info({ msg: 'defender.stopping', signal });
    consumer.stop();
    blockWatcher.stop();
    pipelinePoller?.stop();
    await realtime.close(); // also closes the HTTP server
    await Promise.allSettled([redis.quit(), consumerRedis.quit(), mongo.client.close()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const config = configStore.get();
  log.info({
    msg: 'defender.started',
    configVersion: config.version,
    rules: rules.map((r) => `${r.id}:${config.rules[r.id]?.mode ?? 'missing'}`),
    enforce: env.env === 'staging',
    listen: `${env.bindHost}:${env.port}`,
  });

  await consumer.run();
};

boot().catch((err) => {
  console.error(JSON.stringify({ time: new Date().toISOString(), level: 'fatal', svc: 'defender', msg: 'defender.crashed', error: err?.message }));
  process.exit(1);
});

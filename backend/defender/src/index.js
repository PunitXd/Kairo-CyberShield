// Defender boot (ARCH §15): config → redis → mongo → engine.
// The console API, realtime channel and dashboard join on Oct 20.

import Redis from 'ioredis';

import { createConfigStore, readEnv } from './defender.config.js';
import { createLogger } from './utils/logger.js';
import connectDB from './db/index.js';
import { WindowStore } from './utils/WindowStore.js';
import { createRuleRunner } from './services/ruleRunner.service.js';
import { createConsumer } from './services/consumer.service.js';
import { createRemediation } from './services/remediation.service.js';
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

  const windows = new WindowStore();
  setInterval(() => windows.sweep(Date.now()), SWEEP_MS).unref();

  const remediation = createRemediation({ redis, mongo, env: env.env, log });
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

  const shutdown = async (signal) => {
    log.info({ msg: 'defender.stopping', signal });
    consumer.stop();
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
  });

  await consumer.run();
};

boot().catch((err) => {
  console.error(JSON.stringify({ time: new Date().toISOString(), level: 'fatal', svc: 'defender', msg: 'defender.crashed', error: err?.message }));
  process.exit(1);
});

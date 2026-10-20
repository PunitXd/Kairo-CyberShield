// Reset the demo between judges (PRD F1, PHASES Oct 22 #4), in under 15 s:
//
//   npm run demo:reset      (= node --env-file=.env scripts/demoReset.js)
//
//   1. stop the Defender, so nothing writes while we clear
//   2. in parallel:
//        Redis  delete kairo:* (blocks, throttles, windows, strikes, events,
//               kill switch) and cypherfy:authbackoff:* (CypherFy's own login
//               backoff, which would otherwise hide Kairo on the next run).
//               Targeted, never FLUSHALL: CypherFy's socket state stays.
//        Mongo  empty incidents, actions, audit_log and allowlist in the kairo db.
//               pipeline_runs is kept, so the Pipeline screen works offline.
//        Seed   rerun seedCypherfy.js (demo passwords, room expiry)
//   3. start the Defender, wait until it is healthy, and check the result
//
// Only ever touches the local kairo-demo stack: Redis on the 127.0.0.1 port
// Compose publishes, Mongo through `docker compose exec`, as kairo_defender
// (which can only reach the kairo db). The password goes through the
// environment, never the command line. Prints no secrets.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Redis from 'ioredis';

export const REDIS_URL = 'redis://127.0.0.1:6379'; // docker-compose.yml publishes Redis here only
export const DEFENDER_URL = 'http://127.0.0.1:7070';
export const RESET_PATTERNS = ['kairo:*', 'cypherfy:authbackoff:*'];
export const CLEARED_COLLECTIONS = ['incidents', 'actions', 'audit_log', 'allowlist']; // never pipeline_runs or config_versions
const TARGET_MS = 15_000;
const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Problems that make a reset unsafe or impossible; empty when it may run. */
export const checkResetEnv = (env) => {
  const problems = [];
  if (env.KAIRO_ENV !== 'staging') problems.push('KAIRO_ENV must be staging (the reset only runs against the local demo stack)');
  if (!env.KAIRO_DB_PASSWORD) problems.push('KAIRO_DB_PASSWORD is missing from .env');
  if (!env.DEMO_PASSWORD || !env.DEMO_ROOM_CODE) problems.push('DEMO_PASSWORD and DEMO_ROOM_CODE are needed to reseed CypherFy');
  return problems;
};

/** Runs a command from the repo root → { code, stdout, stderr }. */
const run = (cmd, args, { env = process.env, timeoutMs = 20_000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

const compose = (...args) => run('docker', ['compose', ...args]);

const runningServices = async () => {
  const { code, stdout } = await compose('ps', '--format', 'json');
  if (code !== 0) throw new Error('docker compose ps failed: is Docker running?');
  const rows = stdout.trim().startsWith('[') ? JSON.parse(stdout) : stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return new Map(rows.map((r) => [r.Service, r]));
};

const clearRedis = async () => {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try {
    await redis.connect();
    const counts = {};
    for (const pattern of RESET_PATTERNS) {
      let deleted = 0;
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        if (keys.length) deleted += await redis.unlink(...keys);
        cursor = next;
      } while (cursor !== '0');
      counts[pattern] = deleted;
    }
    return counts;
  } finally {
    redis.disconnect();
  }
};

// Runs inside the mongo container; the password arrives as an environment variable.
const MONGO_SCRIPT = `
const db = connect('mongodb://kairo_defender:' + encodeURIComponent(process.env.KAIRO_DB_PASSWORD) + '@127.0.0.1:27017/kairo');
const out = {};
for (const c of ${JSON.stringify(CLEARED_COLLECTIONS)}) out[c] = db.getCollection(c).deleteMany({}).deletedCount;
out.pipeline_runs = db.getCollection('pipeline_runs').countDocuments();
print(JSON.stringify(out));
`;

const clearMongo = async () => {
  const { code, stdout, stderr } = await compose('exec', '-T', '-e', 'KAIRO_DB_PASSWORD', 'mongo', 'mongosh', '--nodb', '--quiet', '--eval', MONGO_SCRIPT);
  if (code !== 0) throw new Error(`mongo clear failed: ${(stderr || stdout).trim().split('\n').at(-1)?.slice(0, 200)}`);
  return JSON.parse(stdout.trim().split('\n').at(-1));
};

const reseed = async () => {
  const { code, stdout, stderr } = await run(process.execPath, [path.join(ROOT, 'scripts/seedCypherfy.js')]);
  if (code !== 0) throw new Error(`seed failed: ${(stderr || stdout).trim().split('\n').at(-1)?.slice(0, 200)}`);
  return stdout.trim().split('\n').at(-1);
};

const getJson = async (p) => {
  const res = await fetch(`${DEFENDER_URL}${p}`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`${p} → ${res.status}`);
  return res.json();
};

const waitHealthy = async (deadlineMs) => {
  while (Date.now() < deadlineMs) {
    try {
      const h = await getJson('/api/health');
      if (h.redis === 'ok' && h.mongo === 'ok') return h;
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the Defender did not become healthy in time');
};

const main = async () => {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const ok = (msg) => console.log(`  ✓ ${msg.padEnd(62)} ${elapsed()}`);

  const problems = checkResetEnv(process.env);
  if (problems.length) {
    for (const p of problems) console.error(`demo:reset: ${p}`);
    process.exit(2);
  }
  const services = await runningServices();
  const missing = ['redis', 'mongo', 'cypherfy-backend'].filter((s) => services.get(s)?.State !== 'running');
  if (missing.length) throw new Error(`not running: ${missing.join(', ')} (start the stack with npm run stack:up)`);
  console.log('demo:reset  kairo-demo stack (staging)');

  let failed = null;
  const stopped = await compose('stop', '-t', '5', 'kairo-defender');
  if (stopped.code !== 0) throw new Error('could not stop kairo-defender');
  ok('Defender stopped');

  try {
    const [redis, mongo, seed] = await Promise.all([clearRedis(), clearMongo(), reseed()]);
    ok(`Redis: ${n(redis['kairo:*'], 'kairo key')}, ${n(redis['cypherfy:authbackoff:*'], 'CypherFy login-backoff key')} deleted`);
    ok(`Mongo: ${n(mongo.incidents, 'incident')}, ${n(mongo.actions, 'action')}, ${n(mongo.audit_log, 'audit entry').replace('entrys', 'entries')} deleted`);
    ok(`Mongo: ${n(mongo.pipeline_runs, 'pipeline run')} kept`);
    ok(`CypherFy reseeded (${/(\d+) demo accounts/.exec(seed)?.[1] ?? '?'} demo accounts, 1 room)`);
  } catch (err) {
    failed = err;
  }

  // Always bring the Defender back, even after a failed step.
  const started = await compose('start', 'kairo-defender');
  if (started.code !== 0) throw new Error('could not start kairo-defender');
  await waitHealthy(Date.now() + 20_000);
  ok('Defender healthy');
  if (failed) throw failed;

  const [overview, health, pipeline] = await Promise.all([getJson('/api/overview'), getJson('/api/health'), getJson('/api/pipeline/runs?limit=50')]);
  const issues = [];
  if (overview.incidents24h !== 0) issues.push(`${overview.incidents24h} incidents still listed`);
  if (overview.activeBlocks !== 0) issues.push(`${overview.activeBlocks} blocks still active`);
  if (health.killSwitch) issues.push('kill switch still on');
  if (issues.length) throw new Error(`not clean: ${issues.join('; ')}`);
  ok(`Overview empty, kill switch off, ${n(pipeline.items.length, 'pipeline run')} listed`);

  const total = Date.now() - t0;
  console.log(`done in ${(total / 1000).toFixed(1)} s${total > TARGET_MS ? `  (over the ${TARGET_MS / 1000} s target)` : ''}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`demo:reset failed: ${err.message}`);
    process.exit(1);
  });
}

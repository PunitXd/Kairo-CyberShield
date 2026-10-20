// Host-side deployer for R4 (ARCH §3.9, §11.4; PHASES Oct 22 #3).
//
//   npm run deployer        (= node --env-file=.env scripts/deployer.js)
//
// Runs in a terminal on the demo laptop, never in a container: the Defender
// must not hold the Docker socket (ARCH D9). Subscribes to
// kairo:deploy:commands on the Redis port Compose publishes on 127.0.0.1 and
// accepts exactly two commands, for the cypherfy-backend service only:
//
//   { op: 'deploy',   tag, deploymentId }
//   { op: 'rollback', tag, deploymentId, actionId }
//
// The tag must be a git SHA (^[a-f0-9]{7,40}$) whose image cypherfy-backend:<tag>
// is already built (deploy.sh builds it). The deployer re-points the tag
// Compose runs (CYPHERFY_TAG from .env, usually `dev`) at that image, then
//   docker compose up -d --no-deps --no-build --force-recreate cypherfy-backend
// so any later Compose command (`run`, `up`, demo:reset) keeps the deployed
// version instead of quietly reverting it. Everything goes through execFile
// with an argument array (no shell, nothing interpolated), and it
// reports back with the deploy token: `accepted` at once (the Defender fails a
// rollback that isn't acknowledged within 15 s), then `started` or `failed`.
// Commands run one at a time. Prints no secrets.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import Redis from 'ioredis';

import { DEPLOY_KEYS, DEPLOY_TAG_RE } from '../backend/defender/src/defender.constant.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SERVICE = 'cypherfy-backend';
const COMPOSE_TIMEOUT_MS = 120_000;

const log = (msg) => console.log(`${new Date().toLocaleTimeString('en-GB', { hour12: false })}  ${msg}`);

/** Validate one pub/sub message; returns the command or null. */
export const parseCommand = (raw) => {
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!c || typeof c !== 'object' || c.v !== 1) return null;
  if (!['deploy', 'rollback'].includes(c.op)) return null;
  if (typeof c.tag !== 'string' || !DEPLOY_TAG_RE.test(c.tag)) return null;
  if (typeof c.deploymentId !== 'string' || !ULID.test(c.deploymentId)) return null;
  if (c.actionId !== undefined && c.actionId !== null && !(typeof c.actionId === 'string' && ULID.test(c.actionId))) return null;
  return { op: c.op, tag: c.tag, deploymentId: c.deploymentId, actionId: c.actionId ?? null };
};

/** The exact argv the deployer runs (no shell). */
export const composeArgs = (root) => ['compose', '--project-directory', root, 'up', '-d', '--no-deps', '--no-build', '--force-recreate', SERVICE];

/** The tag Compose runs for cypherfy-backend (CYPHERFY_TAG in .env); a plain Docker tag only. */
export const pointerTag = (env = process.env) => {
  const t = env.CYPHERFY_TAG || 'dev';
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,40}$/.test(t)) throw new Error('CYPHERFY_TAG in .env is not a valid image tag');
  return t;
};

const run = (file, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: COMPOSE_TIMEOUT_MS, maxBuffer: 1024 * 1024, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr), code: err?.code ?? 0 })
    );
  });

const lastLine = (s) =>
  String(s)
    .trim()
    .split('\n')
    .pop()
    ?.replace(/[^\x20-\x7e]/g, '')
    .slice(0, 200) || 'unknown error';

const main = async () => {
  const token = process.env.KAIRO_DEPLOY_TOKEN ?? '';
  const defenderUrl = process.env.DEFENDER_URL || 'http://127.0.0.1:7070';
  const redisUrl = process.env.KAIRO_HOST_REDIS_URL || 'redis://127.0.0.1:6379';
  if (token.length < 32) {
    console.error('deployer: KAIRO_DEPLOY_TOKEN (≥ 32 characters) is not set. Run with: node --env-file=.env scripts/deployer.js');
    process.exit(2);
  }

  const report = async (cmd, state, error = null) => {
    try {
      const res = await fetch(`${defenderUrl}/api/deployments/${cmd.deploymentId}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kairo-deploy-token': token },
        body: JSON.stringify({ op: cmd.op, state, actionId: cmd.actionId, ...(error ? { error } : {}) }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) log(`  report ${state} → Defender answered ${res.status}`);
    } catch (err) {
      log(`  report ${state} → Defender unreachable (${err.name})`);
    }
  };

  const execute = async (cmd) => {
    const image = `${SERVICE}:${cmd.tag}`;
    log(`${cmd.op} ${image}`);
    await report(cmd, 'accepted');
    const inspect = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
    if (!inspect.ok) {
      log(`  failed: image ${image} is not built (run scripts/deploy.sh first)`);
      return report(cmd, 'failed', `image ${image} is not built`);
    }
    const started = Date.now();
    // Point the tag Compose runs at this image, so the deploy survives later Compose commands.
    const pointer = `${SERVICE}:${pointerTag()}`;
    const retag = await run('docker', ['tag', image, pointer]);
    if (!retag.ok) {
      log(`  failed: could not tag ${image} as ${pointer}`);
      return report(cmd, 'failed', `could not tag the image: ${lastLine(retag.stderr)}`);
    }
    const up = await run('docker', composeArgs(ROOT), { cwd: ROOT, env: { ...process.env, CYPHERFY_TAG: pointerTag() } });
    if (!up.ok) {
      log(`  failed: ${lastLine(up.stderr)}`);
      return report(cmd, 'failed', `docker compose failed: ${lastLine(up.stderr)}`);
    }
    log(`  started in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return report(cmd, 'started');
  };

  const sub = new Redis(redisUrl, { lazyConnect: true });
  sub.on('error', (err) => log(`redis: ${err.message}`));
  await sub.connect();
  await sub.subscribe(DEPLOY_KEYS.commands);
  log(`deployer ready: ${DEPLOY_KEYS.commands} on ${redisUrl.replace(/\/\/[^@]*@/, '//')} → docker compose (${SERVICE} only, served as ${SERVICE}:${pointerTag()})`);

  let queue = Promise.resolve();
  sub.on('message', (_channel, raw) => {
    const cmd = parseCommand(raw);
    if (!cmd) {
      log('ignored a malformed command');
      return;
    }
    queue = queue.then(() => execute(cmd)).catch((err) => log(`  error: ${err.message}`));
  });

  const stop = async () => {
    log('deployer stopping');
    await sub.quit().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`deployer: ${err.message}`);
    process.exit(1);
  });
}

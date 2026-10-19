// "The legit user is unaffected" proof (PHASES §1). Runs on the HOST (a
// different source IP from the attacker container) and logs in as one real
// demo account every 2 s, printing 200. While bruteforce.js is blocked, this
// keeps printing 200 — only the attacker's source is blocked, not everyone.
//
//   node --env-file=.env attacks/legitCheck.js --target http://localhost:8000
//
// Reads the demo password from DEMO_PASSWORD (via --env-file); never hard-coded.

import { DEFAULT_TARGET, parseArgs } from './utils/args.js';
import { assertAllowedTarget, TargetGuardError } from './utils/targetGuard.js';

const EMAIL = 'demo01@kairo.test';
const INTERVAL_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const args = parseArgs();
  if (args.help) {
    console.log('Usage: node --env-file=.env attacks/legitCheck.js --target http://localhost:8000');
    return;
  }
  const target = typeof args.target === 'string' ? args.target : DEFAULT_TARGET;
  await assertAllowedTarget(target);

  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    console.error('legitCheck: DEMO_PASSWORD is not set. Run with: node --env-file=.env attacks/legitCheck.js');
    process.exit(1);
  }

  const loginUrl = new URL('/api/v1/auth/login', target).toString();
  console.log(`legitCheck → ${loginUrl}  (${EMAIL} every ${INTERVAL_MS / 1000}s; Ctrl+C to stop)\n`);
  process.on('SIGINT', () => process.exit(0));

  for (;;) {
    const at = new Date().toISOString().slice(11, 19);
    try {
      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password }),
      });
      const rule = res.headers.get('x-kairo-rule');
      const mark = res.status === 200 ? 'OK' : `unexpected${rule ? ` (${rule})` : ''}`;
      console.log(`${at}  ${res.status} ${mark}`);
    } catch (err) {
      console.log(`${at}  request failed: ${err.message}`);
    }
    await sleep(INTERVAL_MS);
  }
};

run().catch((err) => {
  if (err instanceof TargetGuardError) {
    console.error(`target guard: ${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

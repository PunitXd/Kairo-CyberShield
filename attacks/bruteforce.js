// R1 demo driver (PRD Q1, F4): credential stuffing against OUR OWN local demo
// stack. It sends wrong passwords across the 20 seeded demo accounts from one
// source so Kairo's R1a throttles and then R1b blocks it; a legit user on a
// different source (legitCheck.js) stays unaffected. Never a real password.
//
//   node attacks/bruteforce.js --target http://localhost:8000
//   docker compose --profile attack run --rm attacker \
//     node attacks/bruteforce.js --target http://cypherfy-backend:8000
//
// The target guard refuses anything that is not localhost / private / Compose.

import { DEFAULT_TARGET, parseArgs } from './utils/args.js';
import { assertAllowedTarget, TargetGuardError } from './utils/targetGuard.js';

const ACCOUNTS = 20;
const MAX_ATTEMPTS = 60;
const WRONG_PASSWORD = 'wrong-password-not-a-real-credential';
const email = (i) => `demo${String((i % ACCOUNTS) + 1).padStart(2, '0')}@kairo.test`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const args = parseArgs();
  if (args.help) {
    console.log('Usage: node attacks/bruteforce.js --target http://localhost:8000 [--count 60]');
    return;
  }
  const target = typeof args.target === 'string' ? args.target : DEFAULT_TARGET;
  await assertAllowedTarget(target); // throws TargetGuardError on a disallowed host

  const loginUrl = new URL('/api/v1/auth/login', target).toString();
  const max = Number(args.count) > 0 ? Number(args.count) : MAX_ATTEMPTS;
  console.log(`bruteforce → ${loginUrl}  (wrong passwords across ${ACCOUNTS} demo accounts)\n`);

  const seq = [];
  let blocked = false;
  for (let i = 0; i < max; i++) {
    let status;
    let rule;
    try {
      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email(i), password: WRONG_PASSWORD }),
      });
      status = res.status;
      rule = res.headers.get('x-kairo-rule');
    } catch (err) {
      console.error(`request failed: ${err.message}`);
      break;
    }
    seq.push(status + (rule ? `(${rule})` : ''));
    if (status === 403) {
      blocked = true;
      break;
    }
    await sleep(status === 429 ? 1000 : 300); // back off while throttled so the gate reopens
  }

  // Group identical results into "401×6 → 429(R1a)×5 → 403(R1b)×1".
  const runs = [];
  for (const s of seq) {
    const last = runs.at(-1);
    if (last && last.code === s) last.n++;
    else runs.push({ code: s, n: 1 });
  }
  console.log(runs.map((r) => `${r.code}×${r.n}`).join(' → '));
  console.log(blocked ? '\nBlocked by Kairo (403). The attacking source is now blocked.' : '\nNot blocked within the attempt budget.');
  process.exitCode = blocked ? 0 : 1;
};

run().catch((err) => {
  if (err instanceof TargetGuardError) {
    console.error(`target guard: ${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

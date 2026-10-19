// R2a demo driver (PRD F4, Q6): guesses ephemeral room codes against OUR OWN
// local demo stack, so Kairo's R2a blocks the source's room lookups. Random
// 6-character codes from CypherFy's 31-symbol alphabet (~887 million codes),
// so a guess hitting a real room is practically impossible.
//
//   node attacks/roomGuess.js --target http://localhost:8000
//   docker compose --profile attack run --rm attacker \
//     node attacks/roomGuess.js --target http://cypherfy-backend:8000
//
// Never prints a guessed code: in CypherFy a room code is the room's key.
// The target guard refuses anything that is not localhost / private / Compose.

import { randomInt } from 'node:crypto';

import { DEFAULT_TARGET, parseArgs } from './utils/args.js';
import { assertAllowedTarget, TargetGuardError } from './utils/targetGuard.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // CypherFy's codeGenerator alphabet
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 40;
const GAP_MS = 250;

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const args = parseArgs();
  if (args.help) {
    console.log('Usage: node attacks/roomGuess.js --target http://localhost:8000 [--count 40]');
    return;
  }
  const target = typeof args.target === 'string' ? args.target : DEFAULT_TARGET;
  await assertAllowedTarget(target); // throws TargetGuardError on a disallowed host

  const max = Number(args.count) > 0 ? Number(args.count) : MAX_ATTEMPTS;
  const base = new URL('/api/v1/rooms/', target);
  console.log(`roomGuess → ${base}<random code>  (codes are never printed)\n`);

  const started = Date.now();
  const seq = [];
  let blockedAfterMs = null;
  for (let i = 0; i < max; i++) {
    let status;
    let rule;
    try {
      const res = await fetch(new URL(randomCode(), base));
      status = res.status;
      rule = res.headers.get('x-kairo-rule');
    } catch (err) {
      console.error(`request failed: ${err.message}`);
      break;
    }
    if (status === 200) seq.push('200(hit, code not shown)');
    else seq.push(status + (rule ? `(${rule})` : ''));
    if (status === 403) {
      blockedAfterMs = Date.now() - started;
      break;
    }
    await sleep(GAP_MS);
  }

  const runs = [];
  for (const s of seq) {
    const last = runs.at(-1);
    if (last && last.code === s) last.n++;
    else runs.push({ code: s, n: 1 });
  }
  console.log(runs.map((r) => `${r.code}×${r.n}`).join(' → '));
  console.log(
    blockedAfterMs !== null
      ? `\nBlocked by Kairo (403) after ${(blockedAfterMs / 1000).toFixed(1)} s. This source can no longer look up rooms.`
      : '\nNot blocked within the attempt budget.'
  );
  process.exitCode = blockedAfterMs !== null ? 0 : 1;
};

run().catch((err) => {
  if (err instanceof TargetGuardError) {
    console.error(`target guard: ${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

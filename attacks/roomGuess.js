// R2a demo driver (PRD F4, Q6): guesses ephemeral room codes against OUR OWN
// local demo stack, so Kairo's R2a blocks the source's room lookups. Random
// 6-character codes from CypherFy's 31-symbol alphabet (~887 million codes),
// so a guess hitting a real room is practically impossible.
//
//   node attacks/roomGuess.js --target http://localhost:8000
//   node attacks/roomGuess.js --via socket --target http://localhost:8000
//   docker compose --profile attack run --rm attacker \
//     node attacks/roomGuess.js --target http://cypherfy-backend:8000
//
// --via http (default) sends GET /api/v1/rooms/:code; --via socket emits
// join_room over a Socket.io connection, which Kairo also disconnects (PRD F4).
// --seed-at N (socket only) sends the REAL demo room code (read from
// DEMO_ROOM_CODE in the environment, never printed) as attempt N, after the
// source is flagged — so Kairo's R2b locks that room into knock mode.
// Never prints a guessed code: in CypherFy a room code is the room's key.
// The target guard refuses anything that is not localhost / private / Compose.

import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';

import { DEFAULT_TARGET, parseArgs } from './utils/args.js';
import { assertAllowedTarget, TargetGuardError } from './utils/targetGuard.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // CypherFy's codeGenerator alphabet
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 40;
const GAP_MS = 250;
const SOCKET_GAP_MS = 450; // < R3a's 3/s, so socket guessing is not also a flood

const randomCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Group a result sequence into "404×7 → 403(R2a)×1" without ever printing a code.
const summarise = (seq) => {
  const runs = [];
  for (const s of seq) {
    const last = runs.at(-1);
    if (last && last.code === s) last.n++;
    else runs.push({ code: s, n: 1 });
  }
  return runs.map((r) => `${r.code}×${r.n}`).join(' → ');
};

const guessOverHttp = async (target, max) => {
  const base = new URL('/api/v1/rooms/', target);
  console.log(`roomGuess (http) → ${base}<random code>  (codes are never printed)\n`);
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
    seq.push(status === 200 ? '200(hit, code not shown)' : status + (rule ? `(${rule})` : ''));
    if (status === 403) {
      blockedAfterMs = Date.now() - started;
      break;
    }
    await sleep(GAP_MS);
  }
  console.log(summarise(seq));
  return blockedAfterMs;
};

const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

const guessOverSocket = async (target, max, seedAt) => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { io } = require('socket.io-client');

  const seedCode = seedAt ? (process.env.DEMO_ROOM_CODE ?? '') : null;
  if (seedAt && !ROOM_CODE_RE.test(seedCode)) {
    console.error('--seed-at needs DEMO_ROOM_CODE in the environment (run: node --env-file=.env attacks/roomGuess.js --via socket --seed-at 40)');
    return { error: true };
  }
  console.log(`roomGuess (socket) → ${target}  join_room with random codes${seedAt ? `, real code at attempt ${seedAt}` : ''} (never printed)\n`);

  let misses = 0;
  let disconnects = 0;
  let reconnects = 0;
  let seeded = false;
  // Open a fresh socket; R2a blocks room_join (not socket), so a reconnect is allowed.
  const open = () =>
    new Promise((resolve) => {
      const s = io(target, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 4000 });
      s.on('error', (p) => p?.code === 'ROOM_NOT_FOUND' && misses++);
      s.on('disconnect', () => disconnects++);
      s.once('connect', () => resolve(s));
      s.once('connect_error', () => resolve(null));
    });

  let socket = await open();
  const started = Date.now();
  for (let attempt = 1; attempt <= max && socket; attempt++) {
    if (!socket.connected) {
      if (++reconnects > 6) break; // give up if we can no longer hold a socket
      socket = await open();
      if (!socket) break;
    }
    const useSeed = seedAt && attempt === seedAt;
    socket.emit('join_room', { code: useSeed ? seedCode : randomCode(), alias: 'guess' });
    if (useSeed) seeded = true;
    await sleep(SOCKET_GAP_MS);
  }
  await sleep(1000);
  socket?.close();
  console.log(`invalid-code replies seen: ${misses}; socket cut ${disconnects}×`);
  return { disconnects, seeded, seedAt, elapsedMs: Date.now() - started };
};

const run = async () => {
  const args = parseArgs();
  const via = typeof args.via === 'string' ? args.via : 'http';
  if (args.help || !['http', 'socket'].includes(via)) {
    console.log('Usage: node [--env-file=.env] attacks/roomGuess.js [--via http|socket] [--seed-at N] --target http://localhost:8000 [--count 40]');
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const target = typeof args.target === 'string' ? args.target : DEFAULT_TARGET;
  await assertAllowedTarget(target); // throws TargetGuardError on a disallowed host
  const max = Number(args.count) > 0 ? Number(args.count) : MAX_ATTEMPTS;

  if (via === 'socket') {
    const seedAt = Number(args['seed-at']) > 0 ? Number(args['seed-at']) : null;
    const r = await guessOverSocket(target, max, seedAt);
    if (r.error) {
      process.exitCode = 2;
      return;
    }
    if (r.seedAt) {
      console.log(
        r.seeded
          ? `\nSocket cut by Kairo (R2a) ${r.disconnects}×; then the real room code was sent at attempt ${r.seedAt} (never printed). Kairo's R2b now locks that room in knock mode — a second browser must knock to join.`
          : `\nThe run ended before attempt ${r.seedAt}, so the seed code was not sent.`
      );
      process.exitCode = r.seeded ? 0 : 1;
      return;
    }
    console.log(
      r.disconnects > 0
        ? `\nSocket cut by Kairo (R2a) after ${(r.elapsedMs / 1000).toFixed(1)} s, and the source's room lookups are now blocked.`
        : '\nNot disconnected within the attempt budget.'
    );
    process.exitCode = r.disconnects > 0 ? 0 : 1;
    return;
  }

  const blockedAfterMs = await guessOverHttp(target, max);
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

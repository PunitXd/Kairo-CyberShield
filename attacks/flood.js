// R3 demo driver (PRD F4): Socket.io abuse against OUR OWN local demo stack, so
// Kairo's R3 family slows down, disconnects and then blocks the source. A
// legit user chatting in the browser (a different socket, usually logged in)
// is never affected. Three modes:
//
//   --mode events       one socket, a burst of events every second → R3a
//                       SLOW_DOWN, then R3b disconnect + socket block, then
//                       KAIRO_BLOCKED on reconnect
//   --mode connections  many rapid guest handshakes → R3c refuses new ones;
//                       sockets already open stay up
//   --mode payload      one socket, malformed send_message packets → R3d
//                       disconnects after the threshold
//
//   node attacks/flood.js --mode events --target http://localhost:8000
//   docker compose --profile attack run --rm attacker \
//     node attacks/flood.js --mode events --target http://cypherfy-backend:8000
//
// Never sends message text, keys or room codes: the event payloads are empty
// or deliberately invalid. The target guard refuses anything that is not
// localhost / private / Compose.

import { createRequire } from 'node:module';

import { DEFAULT_TARGET, parseArgs } from './utils/args.js';
import { assertAllowedTarget, TargetGuardError } from './utils/targetGuard.js';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const MODES = ['events', 'connections', 'payload'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open one guest socket. Resolves { socket } on connect, or { refused, data } on a refused handshake. */
const connect = (url, timeoutMs = 4000) =>
  new Promise((resolve) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: timeoutMs });
    socket.serverErrors = [];
    socket.on('error', (payload) => socket.serverErrors.push(payload?.code ?? 'error'));
    socket.once('connect', () => resolve({ socket }));
    socket.once('connect_error', (err) => resolve({ refused: err.message, data: err.data, socket }));
  });

// ---- events: one socket floods, gets slowed, disconnected, then blocked -----
const floodEvents = async (url, { perSecond, seconds }) => {
  const { socket, refused } = await connect(url);
  if (refused) return console.log(`already blocked at handshake: ${refused}`), true;

  let slowDown = false;
  let disconnectReason = null;
  socket.on('error', (p) => p?.code === 'SLOW_DOWN' && (slowDown ||= (console.log('  ← SLOW_DOWN (R3a throttled this socket)'), true)));
  socket.once('disconnect', (reason) => (disconnectReason = reason));

  console.log(`events → ${url}  (${perSecond} events/s for up to ${seconds}s on one socket)\n`);
  for (let s = 0; s < seconds && !disconnectReason; s++) {
    for (let i = 0; i < perSecond; i++) socket.emit("typing_start", {});
    await sleep(1000);
  }
  if (!disconnectReason) await sleep(1000);

  if (disconnectReason) console.log(`  ← disconnected by the server (R3b): ${disconnectReason}`);
  socket.close();

  // Reconnect: the source now has a socket-scope block, so the handshake is refused.
  const again = await connect(url);
  again.socket?.close();
  if (again.refused) console.log(`  ← reconnect refused (R3b block): ${again.refused}`);

  const ok = slowDown && Boolean(disconnectReason) && Boolean(again.refused);
  console.log(
    ok
      ? '\nSlowed down → disconnected → blocked. The flooding source can no longer open a socket.'
      : `\nIncomplete: slowDown=${slowDown} disconnected=${Boolean(disconnectReason)} reconnectRefused=${Boolean(again.refused)} (are R3a/R3b in enforce?)`
  );
  return ok;
};

// ---- connections: rapid handshakes until new ones are refused ---------------
const floodConnections = async (url, { count }) => {
  console.log(`connections → ${url}  (up to ${count} rapid guest handshakes)\n`);
  const open = [];
  let refusedAfter = null;
  for (let i = 0; i < count && refusedAfter === null; i++) {
    const { socket, refused } = await connect(url);
    if (refused) refusedAfter = { i, refused };
    else open.push(socket);
    await sleep(100);
  }
  // A socket opened before the block stays up: new handshakes are refused, live ones are not.
  const survivor = open[0];
  const survived = Boolean(survivor?.connected);
  for (const s of open) s.close();

  console.log(
    refusedAfter
      ? `  ← handshake #${refusedAfter.i + 1} refused (R3c): ${refusedAfter.refused}\n  ← a socket opened earlier stayed connected: ${survived}`
      : `  all ${open.length} handshakes succeeded (is R3c in enforce? threshold reached?)`
  );
  const ok = Boolean(refusedAfter) && survived;
  console.log(ok ? '\nNew connections blocked; the already-open socket kept working.' : '\nIncomplete.');
  return ok;
};

// ---- payload: malformed packets until the socket is disconnected ------------
const floodPayload = async (url, { count }) => {
  const { socket, refused } = await connect(url);
  if (refused) return console.log(`already blocked at handshake: ${refused}`), true;

  let bad = 0;
  let disconnectReason = null;
  socket.on('error', (p) => p?.code === 'BAD_PAYLOAD' && bad++);
  socket.once('disconnect', (reason) => (disconnectReason = reason));

  console.log(`payload → ${url}  (malformed send_message packets, no valid content)\n`);
  for (let i = 0; i < count && !disconnectReason; i++) {
    socket.emit('send_message', {}); // missing code/roomId and ciphertext → BAD_PAYLOAD
    await sleep(150);
  }
  await sleep(1000);
  if (disconnectReason) console.log(`  ← disconnected by the server (R3d): ${disconnectReason}`);
  socket.close();

  const ok = bad >= 1 && Boolean(disconnectReason);
  console.log(
    ok
      ? `\n${bad} malformed packets were rejected, then R3d disconnected the socket.`
      : `\nIncomplete: badPayloads=${bad} disconnected=${Boolean(disconnectReason)} (is R3d in enforce?)`
  );
  return ok;
};

const run = async () => {
  const args = parseArgs();
  const mode = typeof args.mode === 'string' ? args.mode : 'events';
  if (args.help || !MODES.includes(mode)) {
    console.log(`Usage: node attacks/flood.js --mode ${MODES.join('|')} --target http://localhost:8000 [--count N]`);
    if (!args.help) console.error(`\nunknown mode: ${mode}`);
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const target = typeof args.target === 'string' ? args.target : DEFAULT_TARGET;
  await assertAllowedTarget(target); // throws TargetGuardError on a disallowed host
  const count = Number(args.count) > 0 ? Number(args.count) : undefined;

  let ok;
  if (mode === 'events') ok = await floodEvents(target, { perSecond: count ?? 40, seconds: 12 });
  else if (mode === 'connections') ok = await floodConnections(target, { count: count ?? 40 });
  else ok = await floodPayload(target, { count: count ?? 20 });
  process.exitCode = ok ? 0 : 1;
};

run().catch((err) => {
  if (err instanceof TargetGuardError) {
    console.error(`target guard: ${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(1);
});

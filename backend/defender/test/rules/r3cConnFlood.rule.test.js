import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, IP_B, T0, feed, recordingRunner, socketConnect, withRules } from '../helpers.js';
import { r3cConnFlood } from '../../src/rules/r3cConnFlood.rule.js';

const only = withRules(Object.fromEntries(['R1a', 'R1b', 'R2a', 'R3a', 'R3b', 'R3d'].map((r) => [r, { mode: 'off' }])));
const handshakes = (n, { gapMs = 500, start = T0, ...opts } = {}) =>
  Array.from({ length: n }, (_, i) => socketConnect({ ts: start + i * gapMs, socketId: `s${start}-${i}`, ...opts }));

beforeEach(() => r3cConnFlood.reset());

test('R3c: 19 new connections in 60 s do nothing; the 20th blocks the socket scope for 10 min (high)', async () => {
  const { runner, decisions } = recordingRunner(only);
  await feed(runner, handshakes(19));
  assert.equal(decisions.length, 0);
  await feed(runner, handshakes(1, { start: T0 + 19 * 500 }));
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R3c');
  assert.equal(subject, IP_A);
  assert.equal(decision.severity, 'high');
  assert.deepEqual(decision.actions, [{ type: 'block', scope: 'socket', ttlMs: 600_000 }], 'refuses new handshakes; open sockets stay');
  assert.equal(decision.summary, '20 new connections in 60 s from one source');
});

test('R3c: a logged-in user reconnecting within 5 s counts once (flaky Wi-Fi, page reloads)', async () => {
  const { runner, decisions } = recordingRunner(only);
  await feed(runner, handshakes(40, { gapMs: 1000, userHash: 'a1b2c3d4e5f60718' }));
  assert.equal(decisions.length, 0);
});

test('R3c: the collapse is per session and only within 5 s; guests always count', () => {
  const cfg = only.rules.R3c;
  const m = (ts, opts) => r3cConnFlood.measure(socketConnect({ ts, ...opts }), cfg).value;
  const user = { userHash: 'a1b2c3d4e5f60718' };
  assert.equal(m(T0, user), 1, 'first handshake counts');
  assert.equal(m(T0 + 2000, user), 0, 'reconnect within 5 s collapses');
  assert.equal(m(T0 + 8000, user), 1, 'more than 5 s after the last one counts again');
  assert.equal(m(T0 + 8100, { userHash: 'ffffffffffffffff' }), 1, 'another account is its own session');
  assert.equal(m(T0 + 8200, { ip: IP_B, ...user }), 1, 'same account from another source counts there');
  assert.equal(m(T0 + 8300, {}), 1, 'guests have no session: every handshake counts');
  assert.equal(m(T0 + 8400, {}), 1);
});

test('R3c: sources are counted separately', async () => {
  const { runner, decisions } = recordingRunner(only);
  const a = handshakes(15);
  const b = handshakes(15, { ip: IP_B, start: T0 + 1 });
  await feed(runner, a.flatMap((e, i) => [e, b[i]]));
  assert.equal(decisions.length, 0);
});

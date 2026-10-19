import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, T0, badPayload, feed, recordingRunner, withRules } from '../helpers.js';

const only = withRules(Object.fromEntries(['R1a', 'R1b', 'R2a', 'R3a', 'R3b', 'R3c'].map((r) => [r, { mode: 'off' }])));
const bad = (n, opts = {}) => Array.from({ length: n }, (_, i) => badPayload({ ts: T0 + i * 1000, ...opts }));

test('R3d: 9 malformed payloads in 60 s do nothing; the 10th disconnects the socket (medium)', async () => {
  const { runner, decisions } = recordingRunner(only);
  await feed(runner, bad(9));
  assert.equal(decisions.length, 0);
  await feed(runner, [badPayload({ ts: T0 + 9000, event: 'join_room' })]);
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R3d');
  assert.equal(subject, IP_A);
  assert.equal(decision.severity, 'medium');
  assert.deepEqual(decision.actions, [{ type: 'disconnect', scope: 'socket', params: { socketId: 'sockA' } }]);
  assert.equal(decision.evidence.event, 'join_room');
  assert.equal(decision.evidence.distinct, 2, 'which events were malformed, by name only');
});

test('R3d: counted per socket, and spread-out mistakes never fire', async () => {
  const { runner, decisions } = recordingRunner(only);
  await feed(runner, [...bad(6, { socketId: 'a' }), ...bad(6, { socketId: 'b' })]);
  await feed(runner, Array.from({ length: 20 }, (_, i) => badPayload({ ts: T0 + 100_000 + i * 7000, socketId: 'c' })));
  assert.equal(decisions.length, 0);
});

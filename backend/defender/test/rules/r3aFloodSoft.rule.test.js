import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, T0, feed, recordingRunner, socketRate, withRules } from '../helpers.js';
import { weightedTotal } from '../../src/rules/r3aFloodSoft.rule.js';

const only = (id) => withRules(Object.fromEntries(['R1a', 'R1b', 'R2a', 'R3a', 'R3b', 'R3c', 'R3d'].filter((r) => r !== id).map((r) => [r, { mode: 'off' }])));
const seconds = (n, counts, opts = {}) => Array.from({ length: n }, (_, i) => socketRate({ ts: T0 + i * 1000, counts, ...opts }));

test('R3a: 29 events in 10 s from one socket do nothing; 30 throttle that socket (low, 3/s for 10 s)', async () => {
  const { runner, decisions } = recordingRunner(only('R3a'));
  await feed(runner, [socketRate({ ts: T0, counts: { send_message: 20, typing_start: 9 } })]);
  assert.equal(decisions.length, 0);
  await feed(runner, [socketRate({ ts: T0 + 1000, counts: { send_message: 1 } })]);
  assert.equal(decisions.length, 1);
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R3a');
  assert.equal(subject, IP_A, 'acts on the source; counts the socket');
  assert.equal(decision.severity, 'low');
  assert.deepEqual(decision.actions, [{ type: 'throttle', scope: 'socket', ttlMs: 10_000, params: { socketId: 'sockA', maxPerSec: 3 } }]);
  assert.equal(decision.evidence.observed, 30);
  assert.deepEqual(decision.evidence.histogram, { send_message: 1 });
  assert.equal(decision.summary, '30 socket events in 10 s from one connection');
});

test('R3a: WebRTC signalling counts a quarter, so a call start with 60 ICE candidates stays quiet', async () => {
  const { runner, decisions } = recordingRunner(only('R3a'));
  await feed(runner, seconds(2, { ice_candidate: 30, webrtc_offer: 2, webrtc_answer: 2, send_message: 3 }));
  assert.equal(decisions.length, 0, `weighted ${2 * weightedTotal({ ice_candidate: 30, webrtc_offer: 2, webrtc_answer: 2, send_message: 3 }, { ice_candidate: 0.25, webrtc_offer: 0.25, webrtc_answer: 0.25 })}`);
});

test('R3a: a busy human chat (a message and a typing burst every second, for a minute) never fires', async () => {
  const { runner, decisions } = recordingRunner(only('R3a'));
  // 2 events/s = 20 in 10 s, under the 30 threshold. Task 4 calibrates this against real typing in the web app.
  await feed(runner, seconds(60, { send_message: 1, typing_start: 1 }));
  assert.equal(decisions.length, 0);
});

test('R3a: sockets are counted separately, even from the same source', async () => {
  const { runner, decisions } = recordingRunner(only('R3a'));
  const a = seconds(10, { send_message: 2 }, { socketId: 'sockA' });
  const b = seconds(10, { send_message: 2 }, { socketId: 'sockB' });
  await feed(runner, a.flatMap((e, i) => [e, b[i]])); // 40 from the source, 20 per socket
  assert.equal(decisions.length, 0);
});

test('R3a: keeps firing (renewing the throttle) while the flood goes on', async () => {
  const { runner, decisions } = recordingRunner(only('R3a'));
  await feed(runner, seconds(5, { send_message: 40 }));
  assert.equal(decisions.length, 5);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, T0, badPayload, feed, recordingRunner, socketRate, withRules } from '../helpers.js';

const cfg = (on) => withRules(Object.fromEntries(['R1a', 'R1b', 'R2a', 'R3a', 'R3b', 'R3c', 'R3d'].filter((r) => !on.includes(r)).map((r) => [r, { mode: 'off' }])));

test('R3b: 100 packets in 10 s from one socket disconnect it and block the socket scope (high, ladder)', async () => {
  const { runner, decisions } = recordingRunner(cfg(['R3b']));
  await feed(runner, [socketRate({ ts: T0, counts: { send_message: 99 } })]);
  assert.equal(decisions.length, 0);
  await feed(runner, [socketRate({ ts: T0 + 500, counts: { send_message: 1 } })]);
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R3b');
  assert.equal(subject, IP_A);
  assert.equal(decision.severity, 'high');
  assert.deepEqual(decision.actions, [
    { type: 'disconnect', scope: 'socket', params: { socketId: 'sockA' } },
    { type: 'block', scope: 'socket' },
  ]);
  assert.equal(decision.evidence.observed, 100);
});

test('R3b: three R3a throttles in 5 min escalate, even across reconnects on new sockets', async () => {
  const { runner, decisions } = recordingRunner(cfg(['R3a', 'R3b']));
  // Each burst trips R3a once (30+ in a second) but stays far under 100.
  for (const [i, socketId] of ['s1', 's2', 's3'].entries()) {
    await feed(runner, [socketRate({ ts: T0 + i * 60_000, socketId, counts: { send_message: 35 } })]);
  }
  assert.deepEqual(decisions.map((d) => d.rule), ['R3a', 'R3a', 'R3a', 'R3b']);
  const hard = decisions.at(-1).decision;
  assert.equal(hard.evidence.softFirings, 3);
  assert.equal(hard.actions[0].params.socketId, 's3', 'disconnects the socket in use now');
  assert.match(hard.summary, /slowed down 3× in 5 min/);
});

test('R3b: R3d bad-payload disconnects count toward it too', async () => {
  const { runner, decisions } = recordingRunner(cfg(['R3a', 'R3b', 'R3d']));
  for (const [i, socketId] of ['s1', 's2', 's3'].entries()) {
    await feed(runner, Array.from({ length: 10 }, (_, k) => badPayload({ ts: T0 + i * 30_000 + k * 100, socketId })));
  }
  assert.deepEqual(decisions.map((d) => d.rule), ['R3d', 'R3d', 'R3d']);
  await feed(runner, [socketRate({ ts: T0 + 95_000, socketId: 's4', counts: { send_message: 2 } })]);
  assert.equal(decisions.at(-1).rule, 'R3b');
});

test('R3b: does not keep re-firing on the same soft firings', async () => {
  const { runner, decisions } = recordingRunner(cfg(['R3a', 'R3b']));
  for (let i = 0; i < 3; i++) await feed(runner, [socketRate({ ts: T0 + i * 1000, counts: { send_message: 35 } })]);
  await feed(runner, [socketRate({ ts: T0 + 3500, counts: { send_message: 1 } })]);
  assert.equal(decisions.filter((d) => d.rule === 'R3b').length, 1);
});

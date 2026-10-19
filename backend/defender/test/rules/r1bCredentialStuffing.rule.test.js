import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, T0, authFail, feed, recordingRunner, withRules } from '../helpers.js';

const burst = (count, { start = T0, gapMs = 500, ...rest } = {}) =>
  Array.from({ length: count }, (_, i) => authFail({ ts: start + i * gapMs, ...rest }));

test('R1b: 10 failures in 5 min block auth with a ladder TTL (high)', async () => {
  const { runner, decisions } = recordingRunner(withRules({ R1a: { mode: 'off' } }));
  await feed(runner, burst(9, { gapMs: 20_000 })); // 9 failures over 160 s
  assert.equal(decisions.length, 0);

  await feed(runner, burst(1, { start: T0 + 9 * 20_000 }));
  assert.equal(decisions.length, 1);
  const { rule, decision } = decisions[0];
  assert.equal(rule, 'R1b');
  assert.equal(decision.severity, 'high');
  assert.deepEqual(decision.actions, [{ type: 'block', scope: 'auth' }], 'no ttlMs: the ladder decides');
  assert.equal(decision.evidence.observed, 10);
  assert.equal(decision.evidence.windowMs, 300_000);
  assert.match(decision.summary, /^10 failed logins in 5 min across \d+ accounts$/);
});

test('R1b: counts distinct accounts targeted (credential stuffing)', async () => {
  const { runner, decisions } = recordingRunner(withRules({ R1a: { mode: 'off' } }));
  const accounts = Array.from({ length: 10 }, (_, i) => `${i}`.padStart(16, 'b'));
  await feed(runner, accounts.map((account, i) => authFail({ ts: T0 + i * 100, account })));
  assert.equal(decisions[0].decision.evidence.distinct, 10);
  assert.match(decisions[0].decision.summary, /across 10 accounts/);
});

test('R1b: R1a firing twice in 15 min escalates even below R1b\'s own threshold', async () => {
  // Raise R1b's own threshold out of reach so only the soft-firing path can fire it.
  const { runner, decisions } = recordingRunner(withRules({ R1b: { threshold: 1000 } }));
  await feed(runner, burst(5));
  assert.deepEqual(decisions.map((d) => d.rule), ['R1a']);
  await feed(runner, burst(5, { start: T0 + 5 * 60_000 })); // second R1a firing, 5 min later
  assert.deepEqual(decisions.map((d) => d.rule), ['R1a', 'R1a', 'R1b']);
  const r1b = decisions[2].decision;
  assert.equal(r1b.evidence.softFirings, 2);
  assert.match(r1b.summary, /soft throttle fired 2× in 15 min/);
});

test('R1b: two R1a firings more than 15 min apart do not escalate', async () => {
  const { runner, decisions } = recordingRunner(withRules({ R1b: { threshold: 1000 } }));
  await feed(runner, burst(5));
  await feed(runner, burst(5, { start: T0 + 16 * 60_000 }));
  assert.deepEqual(decisions.map((d) => d.rule), ['R1a', 'R1a']);
});

test('R1b: with live config, a fast burst throttles at 5 and blocks at 10', async () => {
  const { runner, decisions } = recordingRunner(CONFIG);
  await feed(runner, burst(12, { gapMs: 300 }));
  assert.deepEqual(
    decisions.map((d) => `${d.rule}@${(d.ts - T0) / 300 + 1}`),
    ['R1a@5', 'R1a@10', 'R1b@10'],
    'soft step first, hard step at the 10th failure, nothing extra on 11 and 12'
  );
});

test('R1b: after a soft-path block, later R1a firings must add up to 2 again before R1b re-fires', async () => {
  const { runner, decisions } = recordingRunner(withRules({ R1b: { threshold: 1000 } }));
  await feed(runner, burst(10)); // R1a, R1a, R1b
  await feed(runner, burst(5, { start: T0 + 60_000 })); // one more R1a firing: 1 since the block
  assert.deepEqual(decisions.map((d) => d.rule), ['R1a', 'R1a', 'R1b', 'R1a']);
  await feed(runner, burst(5, { start: T0 + 120_000 })); // second since the block
  assert.deepEqual(decisions.map((d) => d.rule), ['R1a', 'R1a', 'R1b', 'R1a', 'R1a', 'R1b']);
});

test('R1b: does not re-fire on in-flight failures right after blocking', async () => {
  const { runner, decisions } = recordingRunner(withRules({ R1a: { mode: 'off' } }));
  await feed(runner, burst(13));
  assert.deepEqual(decisions.map((d) => d.rule), ['R1b']);
});

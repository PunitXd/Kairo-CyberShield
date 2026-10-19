import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, IP_B, T0, authFail, feed, recordingRunner, withRules } from '../helpers.js';

const r1aOnly = withRules({ R1b: { mode: 'off' } });
const burst = (count, { start = T0, gapMs = 500, ...rest } = {}) =>
  Array.from({ length: count }, (_, i) => authFail({ ts: start + i * gapMs, ...rest }));

test('R1a: 4 failures in 60 s do nothing; the 5th throttles auth for 5 min (medium)', async () => {
  const { runner, decisions } = recordingRunner(r1aOnly);
  await feed(runner, burst(4));
  assert.equal(decisions.length, 0);

  await feed(runner, burst(1, { start: T0 + 4 * 500 }));
  assert.equal(decisions.length, 1);
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R1a');
  assert.equal(subject, IP_A);
  assert.equal(decision.severity, 'medium');
  assert.deepEqual(decision.actions, [{ type: 'throttle', scope: 'auth', ttlMs: 300_000 }]);
  assert.equal(decision.evidence.observed, 5);
  assert.equal(decision.evidence.threshold, 5);
  assert.equal(decision.evidence.windowMs, 60_000);
  assert.match(decision.summary, /^5 failed logins in 60 s across \d+ accounts?$/);
});

test('R1a: does not re-fire on the very next failure (window consumed), fires again after 5 more', async () => {
  const { runner, decisions } = recordingRunner(r1aOnly);
  await feed(runner, burst(6));
  assert.equal(decisions.length, 1, 'the 6th failure must not fire again');
  await feed(runner, burst(4, { start: T0 + 6 * 500 }));
  assert.equal(decisions.length, 2, 'five failures after the first firing fire again');
});

test('R1a: failures spread wider than the window never reach the threshold', async () => {
  const { runner, decisions } = recordingRunner(r1aOnly);
  await feed(runner, burst(12, { gapMs: 20_000 })); // at most 4 inside any 60 s
  assert.equal(decisions.length, 0);
});

test('R1a: only credential routes count; other auth failures are ignored', async () => {
  const { runner, decisions } = recordingRunner(r1aOnly);
  for (const route of ['register', 'verify_email', 'forgot_password']) await feed(runner, burst(10, { route }));
  assert.equal(decisions.length, 0);
  await feed(runner, [
    ...burst(2, { route: 'login' }),
    ...burst(1, { route: 'verify_otp' }),
    ...burst(1, { route: 'reset_password' }),
    ...burst(1, { route: 'firebase' }),
  ]);
  assert.equal(decisions.length, 1);
});

test('R1a: sources are counted separately', async () => {
  const { runner, decisions } = recordingRunner(r1aOnly);
  const interleaved = burst(8).map((e, i) => (i % 2 ? { ...e, src: { ...e.src, ipHash: IP_B } } : e));
  await feed(runner, interleaved);
  assert.equal(decisions.length, 0, '4 + 4 across two IPs is not 5 from one');
});

test('R1a: mode off evaluates nothing; shadow still decides (safeguards record it as shadow)', async () => {
  const off = recordingRunner(withRules({ R1a: { mode: 'off' }, R1b: { mode: 'off' } }));
  await feed(off.runner, burst(10));
  assert.equal(off.decisions.length, 0);

  const shadow = recordingRunner(withRules({ R1a: { mode: 'shadow' }, R1b: { mode: 'off' } }));
  await feed(shadow.runner, burst(5));
  assert.equal(shadow.decisions.length, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeline } from '../../src/utils/buildTimeline.js';

const T = 1_760_800_000_000;
const d = (offset) => new Date(T + offset);

const throttle = {
  ruleId: 'R1a', type: 'throttle', scope: 'auth', result: 'applied', ttlMs: 300_000,
  summary: '5 failed logins in 60 s across 5 accounts', triggerEventTs: T,
  requestedAt: d(4), appliedAt: d(12), expiresAt: d(300_004), ttdMs: 4, latencyMs: 12,
};
const block = {
  ruleId: 'R1b', type: 'block', scope: 'auth', result: 'applied', ttlMs: 900_000,
  summary: '10 failed logins in 5 min across 9 accounts', triggerEventTs: T + 25_000,
  requestedAt: d(25_005), appliedAt: d(25_019), expiresAt: d(925_005), ttdMs: 5, latencyMs: 19,
};

test('R1: threshold crossed → throttle → threshold crossed → block → expires, with latencies in ms', () => {
  const steps = buildTimeline({ status: 'open' }, [block, throttle], T + 60_000); // order-insensitive
  assert.deepEqual(
    steps.map((s) => [s.kind, s.label]),
    [
      ['signal', 'R1a threshold crossed'],
      ['action', 'Throttled · auth for 5 min'],
      ['signal', 'R1b threshold crossed'],
      ['action', 'Blocked · auth for 15 min'],
      ['pending', 'Expires'],
    ]
  );
  assert.equal(steps[0].detail, '5 failed logins in 60 s across 5 accounts');
  assert.deepEqual([steps[1].detectMs, steps[1].remediateMs], [4, 12]);
  assert.deepEqual([steps[3].detectMs, steps[3].remediateMs], [5, 19]);
  assert.equal(steps[4].at, T + 925_005, 'the latest expiry decides');
});

test('past the last expiry the incident ends as Expired', () => {
  const steps = buildTimeline({ status: 'open' }, [throttle, block], T + 1_000_000);
  assert.deepEqual(steps.at(-1), { at: T + 925_005, kind: 'resolved', label: 'Expired' });
});

test('an operator unblock ends it as "Unblocked by operator"', () => {
  const lifted = { ...block, liftedAt: d(60_000) };
  const steps = buildTimeline({ status: 'manually_resolved' }, [throttle, lifted], T + 61_000);
  assert.deepEqual(steps.at(-1), { at: T + 60_000, kind: 'resolved', label: 'Unblocked by operator' });
});

test('shadow and other non-actions are recorded honestly, with no expiry step', () => {
  const shadow = { ...throttle, result: 'skipped_shadow', appliedAt: null, expiresAt: null };
  const steps = buildTimeline({ status: 'shadow' }, [shadow], T + 1000);
  assert.deepEqual(steps.map((s) => [s.kind, s.label]), [
    ['signal', 'R1a threshold crossed'],
    ['skipped', 'Would have acted (shadow mode)'],
  ]);
});

test('actions from before triggerEventTs was recorded fall back to appliedAt − latency', () => {
  const { triggerEventTs: _t, ...old } = throttle;
  const [signal] = buildTimeline({ status: 'open' }, [old], T + 1000);
  assert.equal(signal.at, T);
});

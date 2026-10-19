import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, IP_B, T0, authFail, feed, recordingRunner, roomMiss, withRules } from '../helpers.js';

const r2aOnly = withRules({ R1a: { mode: 'off' }, R1b: { mode: 'off' } });
const burst = (count, { start = T0, gapMs = 250, ...rest } = {}) =>
  Array.from({ length: count }, (_, i) => roomMiss({ ts: start + i * gapMs, ...rest }));

test('R2a: 7 invalid codes in 60 s do nothing; the 8th blocks room_join (medium, ladder TTL)', async () => {
  const { runner, decisions } = recordingRunner(r2aOnly);
  await feed(runner, burst(7));
  assert.equal(decisions.length, 0);

  await feed(runner, burst(1, { start: T0 + 7 * 250 }));
  assert.equal(decisions.length, 1);
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R2a');
  assert.equal(subject, IP_A);
  assert.equal(decision.severity, 'medium');
  assert.deepEqual(decision.actions, [{ type: 'block', scope: 'room_join' }], 'no ttlMs: the ladder decides');
  assert.equal(decision.evidence.observed, 8);
  assert.equal(decision.evidence.threshold, 8);
  assert.equal(decision.evidence.windowMs, 60_000);
  assert.equal(decision.evidence.distinct, 8);
  assert.equal(decision.summary, '8 invalid room codes in 60 s (8 distinct)');
});

test('R2a: repeated guesses of the same code count as misses but one distinct code', async () => {
  const { runner, decisions } = recordingRunner(r2aOnly);
  await feed(runner, burst(8, { code: 'cccccccccccccccc' }));
  assert.equal(decisions[0].decision.evidence.distinct, 1);
});

test('R2a: misses spread wider than the window never fire (a human mistyping a code)', async () => {
  const { runner, decisions } = recordingRunner(r2aOnly);
  await feed(runner, burst(20, { gapMs: 10_000 })); // at most 6-7 inside any 60 s
  assert.equal(decisions.length, 0);
});

test('R2a: does not re-fire on the next miss after blocking', async () => {
  const { runner, decisions } = recordingRunner(r2aOnly);
  await feed(runner, burst(12));
  assert.deepEqual(decisions.map((d) => d.rule), ['R2a']);
});

test('R2a: sources are counted separately', async () => {
  const { runner, decisions } = recordingRunner(r2aOnly);
  const interleaved = burst(14).map((e, i) => (i % 2 ? { ...e, src: { ...e.src, ipHash: IP_B } } : e));
  await feed(runner, interleaved);
  assert.equal(decisions.length, 0, '7 + 7 across two IPs is not 8 from one');
});

test('R2a and R1 never count each other\'s signals', async () => {
  const { runner, decisions } = recordingRunner(); // live config, all rules on
  await feed(runner, Array.from({ length: 8 }, (_, i) => authFail({ ts: T0 + i * 250 })));
  assert.ok(!decisions.some((d) => d.rule === 'R2a'), 'login failures are not room guesses');

  const second = recordingRunner();
  await feed(second.runner, burst(8));
  assert.deepEqual(second.decisions.map((d) => d.rule), ['R2a'], 'room guesses do not trip R1');
});

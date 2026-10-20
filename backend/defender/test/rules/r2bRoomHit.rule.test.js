import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, T0, feed, recordingRunner, roomHit, roomMiss, withRules } from '../helpers.js';

const others = ['R1a', 'R1b', 'R1c', 'R3a', 'R3b', 'R3c', 'R3d'];
const enforce = withRules({ ...Object.fromEntries(others.map((r) => [r, { mode: 'off' }])), R2b: { mode: 'enforce' } });

test('R2b: any single hit on a live room → Critical, knock_mode on that room (10 min)', async () => {
  const { runner, decisions } = recordingRunner(enforce);
  await feed(runner, [roomHit({ ts: T0, code: 'af47772dad981591' })]);
  assert.equal(decisions.length, 1);
  const [{ rule, subject, decision }] = decisions;
  assert.equal(rule, 'R2b');
  assert.equal(subject, IP_A, 'acts on the source; the knock targets the room');
  assert.equal(decision.severity, 'critical');
  assert.deepEqual(decision.actions, [{ type: 'knock_mode', scope: 'room', ttlMs: 600_000, params: { codeHash: 'af47772dad981591' } }]);
  assert.equal(decision.evidence.codeHash, 'af47772dad981591');
  assert.equal(decision.summary, 'A flagged source hit a live room; locked it with knock mode');
});

test('R2b shares R2a\'s incident subject (the source), so one incident tells the whole story', async () => {
  const r2 = withRules({ ...Object.fromEntries(['R1a', 'R1b', 'R1c', 'R3a', 'R3b', 'R3c', 'R3d'].map((r) => [r, { mode: 'off' }])), R2b: { mode: 'enforce' } });
  const { runner, decisions } = recordingRunner(r2);
  await feed(runner, Array.from({ length: 8 }, (_, i) => roomMiss({ ts: T0 + i * 100 })));
  await feed(runner, [roomHit({ ts: T0 + 2000 })]);
  assert.deepEqual(decisions.map((d) => [d.rule, d.subject]), [['R2a', IP_A], ['R2b', IP_A]]);
});

test('R2b does not fire on misses, only on hit_while_flagged', async () => {
  const { runner, decisions } = recordingRunner(enforce);
  await feed(runner, Array.from({ length: 20 }, (_, i) => roomMiss({ ts: T0 + i * 100 })));
  assert.equal(decisions.filter((d) => d.rule === 'R2b').length, 0);
});

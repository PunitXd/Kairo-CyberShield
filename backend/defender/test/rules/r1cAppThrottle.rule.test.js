import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IP_A, T0, appThrottled, authFail, feed, recordingRunner, withRules, CONFIG } from '../helpers.js';

const others = ['R1a', 'R1b', 'R2a', 'R3a', 'R3b', 'R3c', 'R3d'];
const only = withRules(Object.fromEntries(others.map((r) => [r, { mode: 'off' }])));

test('R1c: every 429 from CypherFy limiter is recorded (info, app family, no actions)', async () => {
  const { runner, decisions } = recordingRunner(only);
  await feed(runner, [appThrottled({ ts: T0 }), appThrottled({ ts: T0 + 10_000 }), appThrottled({ ts: T0 + 20_000 })]);
  assert.deepEqual(decisions.map((d) => d.rule), ['R1c', 'R1c', 'R1c']);
  const last = decisions.at(-1);
  assert.equal(last.subject, IP_A);
  assert.equal(last.decision.severity, 'info');
  assert.deepEqual(last.decision.actions, [], 'CypherFy already backs off; Kairo only records');
  assert.equal(last.decision.evidence.observed, 3);
  assert.equal(last.decision.summary, "CypherFy's own login limiter answered 429 3× in 5 min");
});

test('R1c ships in shadow, and its config cannot be set to enforce', async () => {
  assert.equal(CONFIG.rules.R1c.mode, 'shadow');
  const { rulesConfigSchema } = await import('../../src/validators/rulesConfig.schema.js');
  const bad = structuredClone(CONFIG);
  bad.rules.R1c.mode = 'enforce';
  assert.equal(rulesConfigSchema.safeParse(bad).success, false);
});

test('R1c never fires on plain auth failures', async () => {
  const { runner, decisions } = recordingRunner(only);
  await feed(runner, Array.from({ length: 12 }, (_, i) => authFail({ ts: T0 + i * 100 })));
  assert.equal(decisions.length, 0);
});

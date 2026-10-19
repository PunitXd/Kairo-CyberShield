import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rulesConfigSchema } from '../../src/validators/rulesConfig.schema.js';
import { CONFIG } from '../helpers.js';

test('rules config: valid file parses; unknown keys and blocks over 60 min are rejected', () => {
  assert.equal(rulesConfigSchema.safeParse(CONFIG).success, true);
  const extra = structuredClone(CONFIG);
  extra.rules.R1a.thresold = 3; // typo must not be silently ignored
  assert.equal(rulesConfigSchema.safeParse(extra).success, false);
  const tooLong = structuredClone(CONFIG);
  tooLong.global.maxBlockMs = 7_200_000;
  assert.equal(rulesConfigSchema.safeParse(tooLong).success, false);
  const cut = structuredClone(CONFIG);
  cut.rules.R3a = { mode: 'enforce', threshold: 30, windowMs: 10_000 };
  assert.equal(rulesConfigSchema.safeParse(cut).success, false, 'cut rules are not configurable in the Demo MVP');
});

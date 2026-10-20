import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paramsText, thresholdText } from '../../src/utils/ruleText.js';

test('threshold and window in words', () => {
  assert.equal(thresholdText({ threshold: 5, windowMs: 60_000 }), '5 in 60 s');
  assert.equal(thresholdText({ threshold: 10, windowMs: 300_000 }), '10 in 5 min');
  assert.equal(thresholdText({ threshold: null, windowMs: 60_000 }), 'window 60 s');
  assert.equal(thresholdText({ threshold: null, windowMs: null }), '—');
});

test('other settings in words; weights (objects) are left out', () => {
  assert.equal(paramsText({ ttlMs: 300_000 }), 'acts for 5 min');
  assert.equal(paramsText({ flagWindowMs: 600_000, knockTtlMs: 600_000 }), 'flag kept 10 min · knock mode 10 min');
  assert.equal(paramsText({ signalWeight: { ice_candidate: 0.25 }, softFiringsThreshold: 3 }, 'R3b'), 'after R3a fired 3×');
  assert.equal(paramsText({ softFiringsThreshold: 2, softFiringsWindowMs: 900_000 }, 'R1b'), 'after R1a fired 2× · R1a firings within 15 min');
  assert.equal(paramsText({ maxPerSec: 3, throttleMs: 10_000 }, 'R3a'), 'slowed to 3 per s · slowed for 10 s');
  assert.equal(paramsText({}), '');
});

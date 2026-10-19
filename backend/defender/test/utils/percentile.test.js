import { test } from 'node:test';
import assert from 'node:assert/strict';

import { percentile } from '../../src/utils/percentile.js';

test('nearest-rank percentile, ignoring non-numbers', () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([null, undefined, NaN], 95), null);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([3, 19], 95), 19);
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(hundred, 95), 95);
  assert.equal(percentile(hundred, 50), 50);
  assert.equal(percentile([5, 1, null, 3], 50), 3);
});

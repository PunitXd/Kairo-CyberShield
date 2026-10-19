import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeBlocks } from '../../src/utils/summarizeBlocks.js';

const NOW = 1_000_000;
const b = (level, inMs) => ({ level, scope: 'auth', subject: 'aaaaaaaaaaaaaaaa', expiresAt: NOW + inMs });

test('counts blocks and throttles, shows the cap and the soonest expiry', () => {
  const s = summarizeBlocks([b('block', 300_000), b('throttle', 281_000), b('block', 900_000)], NOW, 50);
  assert.equal(s.text, '2 blocks · 1 throttle · cap 50 · next expiry in 4:41');
  assert.deepEqual([s.blockCount, s.throttleCount, s.nextExpiryMs], [2, 1, 281_000]);
});

test('ignores expired keys; nothing active means no expiry part', () => {
  assert.equal(summarizeBlocks([b('block', -1)], NOW, 50).text, '0 blocks · 0 throttles · cap 50');
  assert.equal(summarizeBlocks([b('throttle', 61_000)], NOW).text, '0 blocks · 1 throttle · next expiry in 1:01');
});

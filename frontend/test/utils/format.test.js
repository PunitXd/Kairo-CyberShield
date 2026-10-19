import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCountdown, formatLatency } from '../../src/utils/formatDuration.js';
import { formatHash, isHash } from '../../src/utils/formatHash.js';

test('formatLatency for the TTD/TTR tiles', () => {
  assert.equal(formatLatency(null), '—');
  assert.equal(formatLatency(undefined), '—');
  assert.equal(formatLatency(4), '4 ms');
  assert.equal(formatLatency(820), '820 ms');
  assert.equal(formatLatency(1900), '1.9 s');
  assert.equal(formatLatency(12_400), '12 s');
});

test('formatCountdown: m:ss, h:mm:ss, expired', () => {
  assert.equal(formatCountdown(291_000), '4:51');
  assert.equal(formatCountdown(300_000), '5:00');
  assert.equal(formatCountdown(59_400), '1:00', 'rounds up so it never shows 0:00 while active');
  assert.equal(formatCountdown(3_600_000), '1:00:00');
  assert.equal(formatCountdown(0), 'expired');
  assert.equal(formatCountdown(-5), 'expired');
});

test('formatHash shows prefix + first 4 + last 2, and never a raw value', () => {
  assert.equal(formatHash('ip', '3e9a5b0c1d2e44c1'), 'ip:3e9a…c1');
  assert.equal(formatHash('room', 'af47772dad981591'), 'room:af47…91');
  for (const raw of ['172.18.0.5', 'demo01@kairo.test', 'XK9PLM', '3E9A5B0C1D2E44C1', undefined]) {
    assert.equal(isHash(raw), false);
    assert.ok(formatHash('ip', raw).endsWith(':invalid'), String(raw));
    assert.ok(!formatHash('ip', raw).includes(String(raw)) || raw === undefined);
  }
});

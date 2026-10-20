import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isFiltered, isSourceQuery, readFilters, toApiParams } from '../../src/utils/incidentFilters.js';

const T = 1_792_500_000_000;

test('defaults: last 24 h, every state', () => {
  const f = readFilters(new URLSearchParams(''));
  assert.deepEqual(f, { rule: '', severity: '', state: '', range: '24h', source: '' });
  assert.equal(isFiltered(f), false);
  assert.deepEqual(toApiParams(f, T), { ruleId: undefined, severity: undefined, status: undefined, falsePositive: undefined, since: T - 24 * 3600_000, source: undefined });
});

test('reads valid filters and drops malformed ones', () => {
  const f = readFilters(new URLSearchParams('rule=R1a&severity=high&state=open&range=7d&source=ip:3E9A5B'));
  assert.deepEqual(f, { rule: 'R1a', severity: 'high', state: 'open', range: '7d', source: '3e9a5b' });
  const bad = readFilters(new URLSearchParams('rule=$ne&severity=huge&state=deleted&range=1y&source=.*'));
  assert.deepEqual(bad, { rule: '', severity: '', state: '', range: '24h', source: '' });
});

test('false positive is its own state; status is not sent with it', () => {
  const p = toApiParams(readFilters(new URLSearchParams('state=false_positive')), T);
  assert.equal(p.falsePositive, 'true');
  assert.equal(p.status, undefined);
});

test('source search needs a hash or at least 4 hex characters', () => {
  assert.equal(isSourceQuery('3e9a'), true);
  assert.equal(isSourceQuery('ip:3e9a5b0c1d2e44c1'), true);
  assert.equal(isSourceQuery('3e9'), false);
  assert.equal(isSourceQuery('192.168.1.1'), false);
});

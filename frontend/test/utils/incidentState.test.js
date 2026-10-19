import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blockKey, deriveActionState, upsertIncident } from '../../src/utils/incidentState.js';

const NOW = 1_000_000;
const H = '3e9a5b0c1d2e44c1';
const incident = { _id: '01JAB00000000000000000000A', status: 'open', subject: H };
const throttle = { incidentId: incident._id, level: 'throttle', scope: 'auth', subject: H, expiresAt: NOW + 120_000 };
const block = { incidentId: incident._id, level: 'block', scope: 'auth', subject: H, expiresAt: NOW + 300_000 };

test('R1 changes Throttled → Blocked in place when the block arrives (Flow A)', () => {
  assert.deepEqual(deriveActionState(incident, [throttle], NOW), { state: 'throttled', scope: 'auth', expiresAt: NOW + 120_000 });
  assert.deepEqual(deriveActionState(incident, [throttle, block], NOW), { state: 'blocked', scope: 'auth', expiresAt: NOW + 300_000 });
  assert.deepEqual(deriveActionState(incident, [block, throttle], NOW).state, 'blocked', 'order does not matter');
});

test('nothing active any more → Resolved · expired; operator unblock → Resolved · manually', () => {
  assert.equal(deriveActionState(incident, [], NOW).reason, 'expired');
  assert.equal(deriveActionState(incident, [{ ...block, expiresAt: NOW - 1 }], NOW).reason, 'expired', 'an expired key does not count');
  assert.deepEqual(deriveActionState({ ...incident, status: 'manually_resolved' }, [], NOW), {
    state: 'resolved',
    reason: 'manually',
    scope: null,
    expiresAt: null,
  });
});

test('shadow incidents show Shadow even if a key exists', () => {
  assert.equal(deriveActionState({ ...incident, status: 'shadow' }, [block], NOW).state, 'shadow');
});

test('keys belonging to another incident are ignored', () => {
  assert.equal(deriveActionState(incident, [{ ...block, incidentId: 'other' }], NOW).state, 'resolved');
});

test('upsertIncident replaces by id and keeps newest first', () => {
  const a = { _id: '01JAB00000000000000000000A', v: 1 };
  const b = { _id: '01JAB00000000000000000000B', v: 1 };
  let list = upsertIncident([], a);
  list = upsertIncident(list, b);
  assert.deepEqual(list.map((i) => i._id.slice(-1)), ['B', 'A']);
  list = upsertIncident(list, { ...a, v: 2 }); // R1a → R1b update
  assert.deepEqual(list.map((i) => [i._id.slice(-1), i.v]), [['B', 1], ['A', 2]], 'updated in place, no duplicate');
});

test('blockKey separates a throttle and a block on the same source', () => {
  assert.notEqual(blockKey(throttle), blockKey(block));
});

test('kill switch on: an active block reads as Shadow · kill switch, but keeps its scope and expiry for Unblock', () => {
  assert.deepEqual(deriveActionState(incident, [throttle, block], NOW, { killSwitch: true }), {
    state: 'shadow',
    reason: 'kill switch',
    heldBack: 'blocked',
    scope: 'auth',
    expiresAt: NOW + 300_000,
  });
  assert.equal(deriveActionState(incident, [], NOW, { killSwitch: true }).state, 'resolved', 'nothing active: still resolved');
});

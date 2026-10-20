import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createRates, HISTORY_SEC } from '../../src/services/rates.service.js';
import { rules } from '../../src/rules/index.js';
import { CONFIG, IP_A, IP_B, T0, authFail, roomMiss, socketRate } from '../helpers.js';

const setup = () => {
  const clock = { now: T0 };
  const bus = new EventEmitter();
  const ticks = [];
  bus.on('rates.tick', (s) => ticks.push(s));
  const rates = createRates({ rules, getConfig: () => CONFIG, bus, now: () => clock.now, autoTick: false });
  return { clock, rates, ticks };
};

test('each tick carries that second\'s counts per type, then starts a fresh second', () => {
  const { clock, rates, ticks } = setup();
  rates.record(authFail({ ts: T0 }));
  rates.record(authFail({ ts: T0 + 10 }));
  rates.record(roomMiss({ ts: T0 + 20 }));
  rates.tick();
  assert.deepEqual(ticks[0].counts, { 'auth.fail': 2, 'room.join.invalid': 1 });
  assert.equal(ticks[0].total, 3);
  assert.equal(ticks[0].lastEventAt, T0 + 20);
  clock.now += 1000;
  rates.tick();
  assert.deepEqual(ticks[1].counts, {});
});

test('peaks: the busiest single source against its threshold, per charted rule', () => {
  const { rates } = setup();
  for (let i = 0; i < 4; i++) rates.record(authFail({ ts: T0 + i * 100, ip: IP_A }));
  for (let i = 0; i < 2; i++) rates.record(authFail({ ts: T0 + i * 100, ip: IP_B }));
  const { peaks } = rates.tick();
  assert.deepEqual(peaks.R1a, { value: 4, threshold: 5, windowMs: 60_000, mode: 'enforce' });
  assert.equal(peaks.R2a.value, 0);
  assert.equal(peaks.R3a.threshold, 30);
});

test('the R3a peak is per socket and weighted like the rule', () => {
  const { rates } = setup();
  rates.record(socketRate({ ts: T0, socketId: 's1', counts: { ice_candidate: 40, send_message: 2 } }));
  rates.record(socketRate({ ts: T0, socketId: 's2', counts: { send_message: 9 } }));
  assert.equal(rates.tick().peaks.R3a.value, 12, '40 × 0.25 + 2 beats 9');
});

test('peaks keep counting past the threshold (rules reset their own windows; the chart must not drop) and fall as the window empties', () => {
  const { clock, rates } = setup();
  for (let i = 0; i < 12; i++) rates.record(authFail({ ts: T0 + i * 100 }));
  clock.now = T0 + 2000; // after the last event
  assert.equal(rates.tick().peaks.R1a.value, 12);
  clock.now = T0 + 62_000; // the last event plus the 60 s window (one-bucket precision)
  assert.equal(rates.tick().peaks.R1a.value, 0, 'window emptied');
});

test('history keeps the last 5 minutes and filters by windowSec', () => {
  const { clock, rates } = setup();
  for (let s = 0; s < HISTORY_SEC + 20; s++) {
    rates.tick();
    clock.now += 1000;
  }
  assert.ok(rates.history().length <= HISTORY_SEC + 1);
  assert.equal(rates.history(10).length, 10);
});

test('enforced actions become markers on the second they landed in, each action id once', () => {
  const { clock, rates, ticks } = setup();
  const bus = new EventEmitter();
  const r = createRates({ rules, getConfig: () => CONFIG, bus, now: () => clock.now, autoTick: false });
  bus.emit('action.applied', { _id: 'A1', ruleId: 'R1a', type: 'throttle', scope: 'auth', result: 'applied' });
  bus.emit('action.applied', { _id: 'A2', ruleId: 'R3b', type: 'disconnect', scope: 'socket', result: 'sent' });
  bus.emit('action.applied', { _id: 'A2', ruleId: 'R3b', type: 'disconnect', scope: 'socket', result: 'applied' }); // ack
  bus.emit('action.applied', { _id: 'A3', ruleId: 'R1b', type: 'block', scope: 'auth', result: 'skipped_shadow' });
  bus.emit('action.applied', { _id: 'A4', ruleId: 'R2a', type: 'flag', scope: 'room_guess', result: 'applied' });
  const first = r.tick();
  assert.deepEqual(first.actions, [
    { ruleId: 'R1a', type: 'throttle', scope: 'auth' },
    { ruleId: 'R3b', type: 'disconnect', scope: 'socket' },
  ]);
  clock.now += 1000;
  assert.equal(r.tick().actions, undefined, 'markers are not repeated');
  assert.equal(r.history(300)[0].actions.length, 2, 'kept in history for a reload');
  r.stop();
  assert.equal(bus.listenerCount('action.applied'), 0);
  assert.equal(ticks.length, 0);
  rates.stop();
});

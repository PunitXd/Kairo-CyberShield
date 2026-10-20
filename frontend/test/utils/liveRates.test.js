import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PANELS,
  countNew,
  describeEvent,
  markerLabel,
  niceMax,
  panelAriaLabel,
  panelSeries,
  pickDenials,
  sparkSeries,
  statusLine,
} from '../../src/utils/liveRates.js';

const T = 1_792_500_000_000;
const HASH = '3e9a5b7c1d2f40c1';
const peaks = (r1a = 0) => ({
  R1a: { value: r1a, threshold: 5, windowMs: 60_000, mode: 'enforce' },
  R2a: { value: 0, threshold: 8, windowMs: 60_000, mode: 'enforce' },
  R3a: { value: 0, threshold: 30, windowMs: 10_000, mode: 'shadow' },
});
const sample = (i, extra = {}) => ({ t: T + i * 1000, counts: {}, total: 0, peaks: peaks(), lastEventAt: null, ...extra });
const [AUTH, , SOCKET] = PANELS;

test('a panel follows its rule\'s peak, threshold and own event types', () => {
  const samples = [
    sample(0, { counts: { 'auth.fail': 2, 'socket.rate': 4 }, peaks: peaks(2) }),
    sample(1, { counts: { 'auth.fail': 3, 'auth.success': 1 }, peaks: peaks(5) }),
  ];
  const s = panelSeries(samples, AUTH);
  assert.deepEqual(s.points, [
    { t: T, peak: 2, context: 2 },
    { t: T + 1000, peak: 5, context: 3 },
  ]);
  assert.equal(s.threshold, 5);
  assert.equal(s.current, 5);
  assert.equal(panelSeries(samples, SOCKET).points[0].context, 4);
});

test('markers land on their rule family\'s panel, labelled rule · action', () => {
  const samples = [
    sample(0, { actions: [{ ruleId: 'R1a', type: 'throttle', scope: 'auth' }] }),
    sample(1, { actions: [{ ruleId: 'R1b', type: 'block', scope: 'auth' }, { ruleId: 'R3b', type: 'disconnect', scope: 'socket' }] }),
  ];
  assert.deepEqual(panelSeries(samples, AUTH).markers, [
    { t: T, label: 'R1a · Throttled' },
    { t: T + 1000, label: 'R1b · Blocked' },
  ]);
  assert.deepEqual(panelSeries(samples, SOCKET).markers, [{ t: T + 1000, label: 'R3b · Disconnected' }]);
  assert.equal(markerLabel({ ruleId: 'R2b', type: 'knock_mode' }), 'R2b · Knock mode');
});

test('the y-scale always leaves room above the threshold line', () => {
  assert.ok(niceMax([0, 1], 5) >= 6.25);
  assert.equal(niceMax([0], 30), 50);
  assert.ok(niceMax([90], 30) >= 99);
});

test('aria-label says the current value, window and threshold in words', () => {
  const s = panelSeries([sample(0, { peaks: peaks(3) })], AUTH);
  assert.equal(panelAriaLabel(AUTH, s), 'Failed logins: busiest source 3 failed logins in the last 60 s, threshold 5.');
  const sock = panelSeries([sample(0)], SOCKET);
  assert.match(panelAriaLabel(SOCKET, sock), /in the last 10 s, threshold 30 \(shadow\)\.$/);
});

test('sparklines bucket the last 5 minutes', () => {
  const samples = [sample(0, { total: 3 }), sample(1, { total: 4 }), sample(15, { counts: { 'http.denied': 2, 'auth.fail': 9 } })];
  const now = T + 15_000;
  const totals = sparkSeries(samples, (s) => s.total, { now });
  assert.equal(totals.length, 30);
  assert.equal(totals.reduce((a, b) => a + b, 0), 7);
  assert.equal(sparkSeries(samples, pickDenials, { now }).reduce((a, b) => a + b, 0), 2);
});

test('status line: watching, rate, last event, rules in Enforce; warning after 60 s quiet', () => {
  const status = {
    hooks: [{ inst: 'cypherfy-backend-1', alive: true, lastEventAt: T - 400 }],
    rules: [{ id: 'R1a', mode: 'enforce' }, { id: 'R1b', mode: 'enforce' }, { id: 'R1c', mode: 'shadow' }],
  };
  const ok = statusLine({ samples: [sample(0, { total: 37 })], status, now: T });
  assert.deepEqual(ok, { tone: 'ok', text: 'Watching cypherfy-backend-1 · 37 events/s · last event 0.4 s ago · 2 rules in Enforce' });
  const quiet = statusLine({ samples: [sample(0)], status, now: T + 61_000 });
  assert.equal(quiet.tone, 'warning');
  assert.match(quiet.text, /^No events for 61 s from cypherfy-backend-1/);
  assert.equal(statusLine({ samples: [], status: null, now: T }).text.startsWith('No events yet'), true);
});

test('activity rows show hashes and metadata only', () => {
  const row = describeEvent({
    ts: T,
    type: 'auth.fail',
    env: 'staging',
    inst: 'cypherfy-backend-1',
    src: { ipHash: HASH, client: 'web', authed: false },
    auth: { route: 'login', status: 401, accountHash: 'aaaaaaaaaaaaaaaa' },
  });
  assert.equal(row.source, HASH);
  assert.equal(row.detail, 'login · 401');
  assert.equal(describeEvent({ ts: T, type: 'socket.rate', src: { ipHash: HASH, socketId: 'abc' }, sock: { counts: { send_message: 3 }, total: 3, windowMs: 1000 } }).detail, '3 packets: send_message');
});

test('the paused stream counts only events newer than what is on screen', () => {
  const mk = (i) => ({ key: `k${i}`, ts: T + i });
  const shown = [mk(3), mk(2), mk(1)];
  assert.equal(countNew(shown, [mk(5), mk(4), mk(3), mk(2)]), 2);
  assert.equal(countNew(shown, shown), 0);
  assert.equal(countNew([], [mk(1)]), 1);
});

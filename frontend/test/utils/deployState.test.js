import { test } from 'node:test';
import assert from 'node:assert/strict';

import { budgetBanner, canRollBack, deploymentState, graceProgress, healthText, outcomeText } from '../../src/utils/deployState.js';

const T = Date.parse('2026-10-22T10:00:00Z');
const iso = (offset) => new Date(T + offset).toISOString();

test('state words for every deployment status', () => {
  assert.deepEqual(deploymentState({ status: 'deploying', startedAt: null }), { state: 'deploying', label: 'Waiting for the deployer' });
  assert.equal(deploymentState({ status: 'deploying', startedAt: iso(0) }).label, 'Deploying');
  assert.equal(deploymentState({ status: 'rolled_back', rolledBackTo: '46d9e5bb6014' }).label, 'Rolled back → 46d9e5b');
  assert.equal(deploymentState({ status: 'failed' }).label, 'Failed to start');
});

test('grace bar only while deploying inside the grace window', () => {
  const d = { status: 'deploying', startedAt: iso(0) };
  assert.deepEqual(graceProgress(d, 60_000, T + 15_000), { pct: 25, leftMs: 45_000 });
  assert.equal(graceProgress(d, 60_000, T + 61_000), null);
  assert.equal(graceProgress({ ...d, status: 'healthy' }, 60_000, T + 1000), null);
});

test('outcome: time to healthy, time to recovery (unhealthy → previous version serving)', () => {
  assert.equal(outcomeText({ status: 'healthy', startedAt: iso(0), healthyAt: iso(62_000) }), 'healthy in 1 min 2 s');
  assert.equal(outcomeText({ status: 'rolled_back', startedAt: iso(0), unhealthyAt: iso(90_000), rolledBackAt: iso(100_000) }), 'recovered in 10 s');
  assert.equal(outcomeText({ status: 'unhealthy', rollbackFailedAt: iso(1) }), 'rollback did not recover it');
});

test('budget banner: available, used with a countdown, frozen', () => {
  assert.deepEqual(budgetBanner({ frozen: false, budgetAvailableAt: null }, 1_800_000, T), { tone: 'info', text: '1 automatic rollback per 30 min · available' });
  assert.deepEqual(budgetBanner({ frozen: false, budgetAvailableAt: T + 1_752_000 }, 1_800_000, T), { tone: 'warning', text: 'Automatic rollback used · next allowed in 29:12' });
  const frozen = budgetBanner({ frozen: true, frozenReason: 'previous version also unhealthy', budgetAvailableAt: T + 1000 }, 1_800_000, T);
  assert.equal(frozen.tone, 'critical');
  assert.match(frozen.text, /^Rollback paused \(previous version also unhealthy\)\. Manual action needed/);
});

test('health words and who can be rolled back by hand', () => {
  assert.equal(healthText({ ok: false, httpStatus: 500, status: 'error' }), 'Unhealthy · HTTP 500 (error)');
  assert.equal(healthText({ ok: false, error: 'timeout' }), 'Unhealthy · timeout');
  const list = [{ _id: 'b', status: 'unhealthy', prevTag: 'aaaaaaa' }, { _id: 'a', status: 'healthy', prevTag: null }];
  assert.equal(canRollBack(list[0], list, null), true);
  assert.equal(canRollBack(list[1], list, null), false, 'not the latest, and nothing before it');
  assert.equal(canRollBack(list[0], list, 'b'), false, 'a rollback is already running');
});

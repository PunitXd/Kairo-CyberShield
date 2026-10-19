import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultOpenJob,
  findingsForJob,
  findingsNote,
  howToFix,
  runKpiHint,
  runStateLabel,
  syncMessage,
  triggerLabel,
} from '../../src/utils/pipelineState.js';
import { formatAgo, formatRunDuration } from '../../src/utils/formatTime.js';

const blocked = {
  status: 'blocked',
  reason: 'secret',
  branch: 'demo/leaked-secret',
  sha: 'b4ecb3f',
  event: 'pull_request',
  prNumber: 1,
  jobs: [
    { name: 'secrets', status: 'failed' },
    { name: 'deps (backend)', status: 'passed' },
    { name: 'build', status: 'skipped' },
  ],
  findings: [{ tool: 'gitleaks', job: 'secrets', ruleId: 'aws-access-token', redacted: 'AKIA••••••••' }],
  findingsState: 'loaded',
};

test('run state labels: word plus reason', () => {
  assert.equal(runStateLabel(blocked), 'Blocked · secret');
  assert.equal(runStateLabel({ status: 'passed', reason: null }), 'Passed');
  assert.equal(runStateLabel({ status: 'error', reason: 'scanner' }), 'Error · scanner failed');
  assert.equal(runStateLabel(null), '—');
});

test('KPI hint names what blocked, the branch and the commit', () => {
  assert.equal(runKpiHint(blocked), 'Leaked secret · demo/leaked-secret @ b4ecb3f');
  assert.equal(runKpiHint({ status: 'passed', branch: 'kairo', sha: '9a3c9bd' }), 'kairo @ 9a3c9bd');
  assert.equal(runKpiHint(null), 'No pipeline runs yet');
});

test('trigger, default open job and findings per job', () => {
  assert.equal(triggerLabel(blocked), 'PR #1');
  assert.equal(triggerLabel({ event: 'push' }), 'push');
  assert.equal(defaultOpenJob(blocked), 'secrets');
  assert.equal(defaultOpenJob({ jobs: [{ name: 'build', status: 'passed' }] }), null);
  assert.equal(findingsForJob(blocked, 'secrets').length, 1);
  assert.equal(findingsForJob(blocked, 'build').length, 0);
});

test('findings note explains missing findings', () => {
  assert.match(findingsNote({ findingsState: 'token_required' }), /GITHUB_TOKEN/);
  assert.match(findingsNote({ findingsState: 'unavailable' }), /GitHub/);
  assert.equal(findingsNote(blocked), null);
});

test('how to fix: rotate first, and be honest that history is scanned', () => {
  const fix = howToFix(blocked);
  assert.match(fix.title, /Rotate/);
  assert.match(fix.steps.join(' '), /aws-access-token/);
  assert.match(fix.steps.join(' '), /history/);
  assert.equal(howToFix({ status: 'passed' }), null);
  assert.match(howToFix({ status: 'blocked', reason: 'dependency', findings: [{ tool: 'npm-audit', ruleId: 'multer' }] }).steps[0], /multer/);
});

test('sync message only when something is wrong', () => {
  const clock = () => '16:55:00';
  assert.equal(syncMessage({ error: null }, clock), null);
  assert.equal(syncMessage({ error: 'unreachable', lastSuccessAt: '2026-10-19T16:55:00Z' }, clock), "Can't reach GitHub. Last synced 16:55:00; showing stored runs.");
  assert.match(syncMessage({ error: 'poller_off' }, clock), /GITHUB_REPO/);
  assert.match(syncMessage({ error: 'token_invalid' }, clock), /rejected the token/);
});

test('formatAgo and formatRunDuration', () => {
  const now = 1_000_000_000;
  assert.equal(formatAgo(now - 10_000, now), 'just now');
  assert.equal(formatAgo(now - 4 * 60_000, now), '4 min ago');
  assert.equal(formatAgo(now - 3 * 3600_000, now), '3 h ago');
  assert.equal(formatAgo(now - 2 * 86_400_000, now), '2 d ago');
  assert.equal(formatAgo(null, now), '—');
  assert.equal(formatRunDuration(7000), '7 s');
  assert.equal(formatRunDuration(95_000), '1 min 35 s');
  assert.equal(formatRunDuration(120_000), '2 min');
  assert.equal(formatRunDuration(null), '—');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGitleaksReport,
  parseNpmAuditReport,
  parseTrivyReport,
  pickFixedVersion,
  redactSecret,
  reportParserFor,
  runOutcome,
  summarizeRun,
  toRunDoc,
} from '../../src/services/pipeline.service.js';

const REPO = 'PunitXd/CypherFy';
// Built at runtime so no key-shaped literal sits in the source (Gitleaks scans this repo too).
const FAKE_KEY = ['AK', 'IA', 'Q3', 'TESTONLYNOTREAL'.padEnd(14, 'X')].join('');

const ghRun = (over = {}) => ({
  id: 101,
  path: '.github/workflows/kairo-shield.yml',
  head_branch: 'demo/leaked-secret',
  head_sha: 'b4ecb3fb269ee2e797d2f836df34bf5e8871adf1',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  html_url: `https://github.com/${REPO}/actions/runs/101`,
  run_started_at: '2026-10-19T16:52:51Z',
  updated_at: '2026-10-19T16:53:06Z',
  run_attempt: 1,
  display_title: 'Add R2 storage config',
  head_commit: { message: 'Add R2 storage config\n\nbody' },
  pull_requests: [],
  actor: { login: 'dev' },
  ...over,
});

const ghJob = (name, conclusion, over = {}) => ({
  name,
  status: 'completed',
  conclusion,
  started_at: '2026-10-19T16:52:54Z',
  completed_at: '2026-10-19T16:53:01Z',
  html_url: `https://github.com/${REPO}/actions/runs/101/job/1`,
  ...over,
});

const leakJobs = [ghJob('secrets', 'failure'), ghJob('deps (backend)', 'success'), ghJob('build', 'skipped')];

test('redactSecret keeps at most a 4-character prefix, even for an unredacted report', () => {
  assert.equal(redactSecret('AKIA...'), 'AKIA••••••••');
  assert.equal(redactSecret(FAKE_KEY), 'AKIA••••••••');
  assert.equal(redactSecret('REDACTED'), '••••••••');
  assert.equal(redactSecret(undefined), '••••••••');
  assert.equal(redactSecret(['gh', 'p_', 'x'.repeat(36)].join('')), 'ghp_••••••••'); // built at runtime, like FAKE_KEY
  assert.equal(redactSecret('short'), 's••••••••'); // 20% of 5 chars, like Gitleaks --redact=80
  assert.equal(redactSecret('abcd'), '••••••••');
});

test('parseGitleaksReport keeps only rule, file, line, commit and the redacted value', () => {
  const [f, ...rest] = parseGitleaksReport([
    {
      RuleID: 'aws-access-token',
      File: 'backend/src/config/storage.js',
      StartLine: 8,
      Commit: '16784d8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      Secret: FAKE_KEY,
      Match: `R2_ACCESS_KEY_ID = "${FAKE_KEY}"`,
      Author: 'Someone',
      Email: 'someone@example.com',
      Message: 'commit message',
    },
    { RuleID: 'bad rule id!', File: 'x', StartLine: 1 }, // skipped, not trusted
  ]);
  assert.equal(rest.length, 0);
  assert.deepEqual(f, {
    tool: 'gitleaks',
    job: 'secrets',
    ruleId: 'aws-access-token',
    file: 'backend/src/config/storage.js',
    line: 8,
    commit: '16784d8',
    severity: 'critical',
    redacted: 'AKIA••••••••',
  });
  const stored = JSON.stringify(f);
  for (const leak of [FAKE_KEY, FAKE_KEY.slice(4), 'someone@example.com', 'Someone', 'R2_ACCESS_KEY_ID']) {
    assert.ok(!stored.includes(leak), `stored finding must not contain ${leak}`);
  }
  assert.throws(() => parseGitleaksReport({}), /not an array/);
});

test('parseNpmAuditReport keeps high and critical advisories only', () => {
  const findings = parseNpmAuditReport(
    {
      auditReportVersion: 2,
      vulnerabilities: {
        multer: { name: 'multer', severity: 'high', via: [{ title: 'Multer DoS' }], fixAvailable: { name: 'multer' } },
        lodash: { name: 'lodash', severity: 'moderate', via: [{ title: 'meh' }], fixAvailable: true },
        busboy: { name: 'busboy', severity: 'critical', via: ['multer'], fixAvailable: false },
      },
    },
    'backend',
  );
  assert.deepEqual(
    findings.map((f) => [f.ruleId, f.severity, f.title, f.fixAvailable, f.file, f.job]),
    [
      ['multer', 'high', 'Multer DoS', true, 'backend/package-lock.json', 'deps (backend)'],
      ['busboy', 'critical', null, false, 'backend/package-lock.json', 'deps (backend)'],
    ],
  );
  assert.deepEqual(parseNpmAuditReport({ auditReportVersion: 2, vulnerabilities: {} }, 'backend'), []);
  assert.throws(() => parseNpmAuditReport({ error: { code: 'ENOAUDIT' } }, 'backend'), /error/);
});

test('parseTrivyReport keeps fixable high and critical vulnerabilities, critical first, deduplicated', () => {
  const vuln = (id, pkg, sev, fixed = '1.2.3') => ({ VulnerabilityID: id, PkgName: pkg, InstalledVersion: '1.0.0', FixedVersion: fixed, Severity: sev, Title: 't', Description: 'long text that is dropped' });
  const report = {
    SchemaVersion: 2,
    Results: [
      { Target: 'kairo-scan/backend:abc (alpine 3.24)', Type: 'alpine', Vulnerabilities: [vuln('CVE-2026-1', 'libcrypto3', 'HIGH', '3.3.7-r0'), vuln('CVE-2026-2', 'curl', 'MEDIUM')] },
      { Target: 'Node.js', Type: 'node-pkg', Vulnerabilities: [vuln('CVE-2025-47935', 'multer', 'CRITICAL', '2.0.0, 1.4.6'), vuln('CVE-2025-47935', 'multer', 'CRITICAL'), vuln('CVE-2026-3', 'lodash', 'HIGH', '')] },
      { Target: 'app', Type: 'node-pkg' },
    ],
  };
  const findings = parseTrivyReport(report, 'backend');
  assert.deepEqual(findings, [
    { tool: 'trivy', job: 'image (backend)', ruleId: 'CVE-2025-47935', file: 'backend image · multer', line: null, severity: 'critical', title: 'multer 1.0.0 → 1.4.6', fixAvailable: true },
    { tool: 'trivy', job: 'image (backend)', ruleId: 'CVE-2026-1', file: 'backend image · libcrypto3', line: null, severity: 'high', title: 'libcrypto3 1.0.0 → 3.3.7-r0', fixAvailable: true },
  ]);
  assert.deepEqual(parseTrivyReport({ SchemaVersion: 2, ArtifactName: 'x' }, 'web'), [], 'a clean image has no Results');
  assert.equal(pickFixedVersion('2.0.2', '5.0.10, 3.0.7, 2.1.5, 1.1.19'), '2.1.5', 'same major line');
  assert.equal(pickFixedVersion('1.4.5-lts.2', '2.0.0'), '2.0.0', 'no fix on this line: the first one');
  assert.equal(pickFixedVersion('3.3.3-r0', '3.3.7-r0'), '3.3.7-r0');
  assert.throws(() => parseTrivyReport([], 'web'), /not an object/);
  assert.throws(() => parseTrivyReport({ Results: 'x' }, 'web'), /Results/);
});

test('reportParserFor maps the workflow artifact names', () => {
  assert.ok(reportParserFor('kairo-secrets'));
  assert.deepEqual(reportParserFor('kairo-deps-frontend-web')({ vulnerabilities: {} }), []);
  assert.deepEqual(reportParserFor('kairo-image-frontend-web')({ Results: [] }), []);
  assert.equal(reportParserFor('something-else'), null);
});

test('toRunDoc maps a blocked push run with its finding', () => {
  const findings = parseGitleaksReport([{ RuleID: 'aws-access-token', File: 'a.js', StartLine: 8, Secret: 'AKIA...' }]);
  const doc = toRunDoc({ repo: REPO, run: ghRun(), jobs: leakJobs, findings, findingsState: 'loaded', now: 0 });
  assert.equal(doc._id, 101);
  assert.equal(doc.status, 'blocked');
  assert.equal(doc.reason, 'secret');
  assert.equal(doc.title, 'Add R2 storage config');
  assert.equal(doc.workflow, 'kairo-shield.yml');
  assert.equal(doc.durationMs, 15_000);
  assert.deepEqual(
    doc.jobs.map((j) => [j.name, j.status, j.durationMs]),
    [
      ['secrets', 'failed', 7000],
      ['deps (backend)', 'passed', 7000],
      ['build', 'skipped', 7000],
    ],
  );
  assert.equal(doc.settled, true);
});

test('toRunDoc uses the PR number and title for pull_request runs', () => {
  const doc = toRunDoc({
    repo: REPO,
    run: ghRun({ event: 'pull_request', pull_requests: [{ number: 1 }], display_title: 'DO NOT MERGE: demo' }),
    jobs: leakJobs,
  });
  assert.equal(doc.prNumber, 1);
  assert.equal(doc.title, 'DO NOT MERGE: demo');
});

test('toRunDoc drops links that do not point at the configured repo', () => {
  const doc = toRunDoc({ repo: REPO, run: ghRun({ html_url: 'https://evil.example/x' }), jobs: [ghJob('secrets', 'failure', { html_url: 'javascript:alert(1)' })] });
  assert.equal(doc.url, null);
  assert.equal(doc.jobs[0].url, null);
});

test('a run is not settled while GitHub still lists a job as running', () => {
  const doc = toRunDoc({
    repo: REPO,
    run: ghRun({ conclusion: 'success' }),
    jobs: [ghJob('secrets', null, { status: 'in_progress', completed_at: null }), ghJob('build', 'success')],
  });
  assert.equal(doc.status, 'passed');
  assert.equal(doc.settled, false);
  assert.equal(doc.jobs[0].status, 'running');
});

test('runOutcome: running, passed, blocked by build, scanner error, cancelled', () => {
  const jobs = (failed) => [{ name: failed, status: 'failed' }];
  assert.deepEqual(runOutcome({ status: 'in_progress' }, [], [], 'pending'), { status: 'running', reason: null });
  assert.deepEqual(runOutcome({ status: 'completed', conclusion: 'success' }, [], [], 'loaded'), { status: 'passed', reason: null });
  const failure = { status: 'completed', conclusion: 'failure' };
  assert.deepEqual(runOutcome(failure, jobs('build'), [], 'loaded'), { status: 'blocked', reason: 'build' });
  // The secrets job failed but its report had no findings: Gitleaks itself broke.
  assert.deepEqual(runOutcome(failure, jobs('secrets'), [], 'loaded'), { status: 'error', reason: 'scanner' });
  // Without the reports (no token), a failed scanner job is reported by job.
  assert.deepEqual(runOutcome(failure, jobs('secrets'), [], 'token_required'), { status: 'blocked', reason: 'secret' });
  assert.deepEqual(runOutcome(failure, jobs('deps (backend)'), [], 'token_required'), { status: 'blocked', reason: 'dependency' });
  assert.deepEqual(runOutcome(failure, jobs('image (backend)'), [], 'token_required'), { status: 'blocked', reason: 'image' });
  assert.deepEqual(runOutcome(failure, jobs('image (backend)'), [{ tool: 'trivy' }], 'loaded'), { status: 'blocked', reason: 'image' });
  assert.deepEqual(runOutcome(failure, jobs('image (backend)'), [], 'loaded'), { status: 'error', reason: 'scanner' }, 'Trivy broke');
  assert.deepEqual(runOutcome({ status: 'completed', conclusion: 'cancelled' }, [], [], 'pending'), { status: 'error', reason: 'cancelled' });
});

test('summarizeRun gives the KPI tile fields', () => {
  const doc = toRunDoc({ repo: REPO, run: ghRun(), jobs: leakJobs, findings: [], findingsState: 'token_required' });
  assert.deepEqual(summarizeRun(doc), {
    id: 101,
    status: 'blocked',
    reason: 'secret',
    branch: 'demo/leaked-secret',
    sha: 'b4ecb3f',
    event: 'push',
    prNumber: null,
    finishedAt: new Date('2026-10-19T16:53:06Z'),
  });
  assert.equal(summarizeRun(null), null);
});

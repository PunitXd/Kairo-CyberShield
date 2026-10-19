// Pipeline runs (ARCH §4.4, §8.2 `pipeline_runs`): turns GitHub Actions API
// responses and the workflow's report artifacts into PipelineRun documents.
// Pure functions; the GitHub poller does the I/O.
//
// Secrets: the workflow already redacts Gitleaks output (--redact=80), and
// this module redacts again: a finding keeps at most the first 4 characters
// of the match (the key-type prefix, e.g. "AKIA"), never Gitleaks' Match,
// Author or Email fields. Even an unredacted report is stored as "AKIA••••••••".

import { z } from 'zod';

export const PIPELINE_STATUS = ['running', 'passed', 'blocked', 'error'];
export const SCAN_JOBS = { secrets: 'gitleaks', deps: 'npm-audit' };
const MASK = '••••••••';
const MAX_FINDINGS = 50;

/** First ≤4 characters of a secret (Gitleaks partial redaction ends in "..."), then a fixed mask. */
export const redactSecret = (secret) => {
  const s = typeof secret === 'string' ? secret : '';
  if (!s || s === 'REDACTED') return MASK;
  const redacted = s.endsWith('...');
  const visible = redacted ? s.slice(0, -3) : s.slice(0, Math.floor(s.length * 0.2));
  return `${visible.slice(0, 4).replace(/[^\w-]/g, '')}${MASK}`;
};

const zText = (max) => z.string().max(max * 4).transform((s) => s.slice(0, max));

// Gitleaks JSON report: only the fields we keep are read; everything else is dropped.
const gitleaksFindingSchema = z.object({
  RuleID: z.string().regex(/^[\w.-]{1,80}$/),
  File: zText(300),
  StartLine: z.number().int().nonnegative(),
  Commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  Secret: z.string().optional(),
});

/** Gitleaks report (array) → findings. Unparseable entries are skipped, not trusted. */
export const parseGitleaksReport = (report) => {
  if (!Array.isArray(report)) throw new Error('gitleaks report is not an array');
  return report.slice(0, MAX_FINDINGS).flatMap((raw) => {
    const r = gitleaksFindingSchema.safeParse(raw);
    if (!r.success) return [];
    const f = r.data;
    return [
      {
        tool: 'gitleaks',
        job: 'secrets',
        ruleId: f.RuleID,
        file: f.File,
        line: f.StartLine,
        commit: f.Commit?.slice(0, 7) ?? null,
        severity: 'critical',
        redacted: redactSecret(f.Secret),
      },
    ];
  });
};

const npmVulnSchema = z.object({
  name: z.string().regex(/^[@\w./-]{1,214}$/),
  severity: z.enum(['info', 'low', 'moderate', 'high', 'critical']),
  fixAvailable: z.unknown().optional(),
  via: z.array(z.unknown()).optional(),
});

/** npm audit --json (v2) → high/critical findings for one project. */
export const parseNpmAuditReport = (report, project) => {
  if (!report || typeof report !== 'object') throw new Error('npm audit report is not an object');
  if (report.error) throw new Error('npm audit reported an error');
  return Object.values(report.vulnerabilities ?? {})
    .flatMap((raw) => {
      const r = npmVulnSchema.safeParse(raw);
      if (!r.success || !['high', 'critical'].includes(r.data.severity)) return [];
      const advisory = r.data.via?.find((v) => v && typeof v === 'object' && typeof v.title === 'string');
      return [
        {
          tool: 'npm-audit',
          job: `deps (${project})`,
          ruleId: r.data.name,
          file: `${project}/package-lock.json`,
          line: null,
          severity: r.data.severity,
          title: advisory ? advisory.title.slice(0, 160) : null,
          fixAvailable: Boolean(r.data.fixAvailable),
        },
      ];
    })
    .slice(0, MAX_FINDINGS);
};

/** Artifact name → which parser reads its JSON files. */
export const reportParserFor = (artifactName) => {
  if (artifactName === 'kairo-secrets') return (json) => parseGitleaksReport(json);
  const deps = /^kairo-deps-([\w-]{1,40})$/.exec(artifactName);
  if (deps) return (json) => parseNpmAuditReport(json, deps[1]);
  return null;
};

const jobStatus = (j) => {
  if (j.status !== 'completed') return j.status === 'in_progress' ? 'running' : 'queued';
  return { success: 'passed', failure: 'failed', skipped: 'skipped', cancelled: 'cancelled' }[j.conclusion] ?? 'failed';
};

const ms = (iso) => (iso ? Date.parse(iso) : null);
const toDate = (iso) => (iso ? new Date(iso) : null);

/** Does a failed job belong to a scanner, and which one? "deps (backend)" → npm-audit. */
const scanToolOf = (jobName) => SCAN_JOBS[jobName.split(' ')[0]] ?? null;

/**
 * Run status (ARCH §8.2): running | passed | blocked | error, plus why it was blocked.
 * A scanner job that failed with findings blocks; one that failed without
 * findings is a scanner error (the pipeline fails closed, PRD F5). A failed
 * build blocks. Cancelled / timed-out runs are errors.
 */
export const runOutcome = (run, jobs, findings, findingsState) => {
  if (run.status !== 'completed') return { status: 'running', reason: null };
  if (run.conclusion === 'success') return { status: 'passed', reason: null };
  if (run.conclusion !== 'failure') return { status: 'error', reason: run.conclusion ?? 'unknown' };

  const failed = jobs.filter((j) => j.status === 'failed');
  if (findings.some((f) => f.tool === 'gitleaks')) return { status: 'blocked', reason: 'secret' };
  if (findings.some((f) => f.tool === 'npm-audit')) return { status: 'blocked', reason: 'dependency' };
  if (failed.some((j) => j.name === 'build')) return { status: 'blocked', reason: 'build' };
  // A scanner failed and its report had no findings. Without the reports
  // (no token yet) we can't tell a finding from a crash, so say which job failed.
  if (findingsState !== 'loaded') {
    const tool = failed.map((j) => scanToolOf(j.name)).find(Boolean);
    if (tool) return { status: 'blocked', reason: tool === 'gitleaks' ? 'secret' : 'dependency' };
  }
  return { status: 'error', reason: 'scanner' };
};

const firstLine = (s) => (typeof s === 'string' ? s.split('\n')[0].slice(0, 120) : null);

/**
 * GitHub run + jobs (+ parsed findings) → PipelineRun document.
 * findingsState: loaded | pending | token_required | unavailable.
 */
export const toRunDoc = ({ repo, run, jobs, findings = [], findingsState = 'pending', now = Date.now() }) => {
  const prefix = `https://github.com/${repo}/`;
  const safeUrl = (u) => (typeof u === 'string' && u.startsWith(prefix) ? u : null);
  const docJobs = (jobs ?? []).map((j) => {
    const startedAt = ms(j.started_at);
    const finishedAt = j.status === 'completed' ? ms(j.completed_at) : null;
    return {
      name: String(j.name).slice(0, 80),
      status: jobStatus(j),
      startedAt: toDate(j.started_at),
      finishedAt: finishedAt ? new Date(finishedAt) : null,
      durationMs: startedAt && finishedAt && finishedAt >= startedAt ? finishedAt - startedAt : null,
      url: safeUrl(j.html_url),
    };
  });
  const { status, reason } = runOutcome(run, docJobs, findings, findingsState);
  const startedAt = ms(run.run_started_at ?? run.created_at);
  const finishedAt = run.status === 'completed' ? ms(run.updated_at) : null;
  const pr = run.event === 'pull_request' ? (run.pull_requests?.[0]?.number ?? null) : null;

  return {
    _id: run.id,
    repo,
    workflow: run.path?.split('/').pop() ?? null,
    branch: String(run.head_branch ?? '').slice(0, 200),
    sha: run.head_sha,
    event: run.event,
    prNumber: pr,
    // A PR run's title is the PR title; a push run's is the commit subject.
    title: pr ? firstLine(run.display_title) : firstLine(run.head_commit?.message ?? run.display_title),
    actor: run.actor?.login ?? null,
    attempt: run.run_attempt ?? 1,
    status,
    reason,
    url: safeUrl(run.html_url),
    startedAt: startedAt ? new Date(startedAt) : null,
    finishedAt: finishedAt ? new Date(finishedAt) : null,
    durationMs: startedAt && finishedAt && finishedAt >= startedAt ? finishedAt - startedAt : null,
    jobs: docJobs,
    findings,
    findingsState,
    // GitHub's job list can lag the run (a job still "in_progress" after the
    // run completed), so a run is only final once every job has finished.
    settled: run.status === 'completed' && docJobs.every((j) => !['queued', 'running'].includes(j.status)),
    ghUpdatedAt: run.updated_at ?? null, // GitHub's own change marker; the poller refetches when it moves
    syncedAt: new Date(now),
  };
};

/** The fields a viewer sees; used to skip no-op writes and pushes. */
export const runFingerprint = (doc) =>
  JSON.stringify([doc.status, doc.reason, doc.jobs.map((j) => [j.name, j.status]), doc.findings.length, doc.findingsState, doc.settled]);

/** Last pipeline KPI (BRIEF §6 S1): "Blocked · secret", "Passed", "Running", "Error". */
export const summarizeRun = (doc) =>
  doc && {
    id: doc._id,
    status: doc.status,
    reason: doc.reason,
    branch: doc.branch,
    sha: doc.sha?.slice(0, 7) ?? null,
    event: doc.event,
    prNumber: doc.prNumber,
    finishedAt: doc.finishedAt,
  };

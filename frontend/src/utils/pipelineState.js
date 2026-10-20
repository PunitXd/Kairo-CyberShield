// Words for pipeline runs (BRIEF §6 S5, Flow C). Plain functions so they can
// be unit-tested with node --test. A run's state is always a word plus an
// icon, never colour alone (BRIEF §10).

const RUN_WORD = { running: 'Running', passed: 'Passed', blocked: 'Blocked', error: 'Error' };
const REASON_WORD = { secret: 'secret', dependency: 'dependency', image: 'image', build: 'build', scanner: 'scanner failed', cancelled: 'cancelled', timed_out: 'timed out' };
const REASON_SENTENCE = {
  secret: 'Leaked secret',
  dependency: 'Vulnerable dependency',
  image: 'Vulnerable container image',
  build: 'Build failed',
  scanner: 'A scanner failed',
};
const JOB_WORD = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped', running: 'Running', queued: 'Queued', cancelled: 'Cancelled' };

/** "Blocked · secret", "Passed", "Error · cancelled". */
export const runStateLabel = (run) => {
  if (!run) return '—';
  const word = RUN_WORD[run.status] ?? run.status;
  const reason = run.reason ? (REASON_WORD[run.reason] ?? run.reason) : null;
  return reason ? `${word} · ${reason}` : word;
};

/** KPI hint: "Leaked secret · demo/leaked-secret @ b4ecb3f". */
export const runKpiHint = (run) => {
  if (!run) return 'No pipeline runs yet';
  const what = run.status === 'blocked' || run.status === 'error' ? `${REASON_SENTENCE[run.reason] ?? runStateLabel(run)} · ` : '';
  return `${what}${run.branch} @ ${run.sha ?? ''}`.trim();
};

export const jobStateLabel = (status) => JOB_WORD[status] ?? status;

/** "PR #1" or "push". */
export const triggerLabel = (run) => (run.event === 'pull_request' ? (run.prNumber ? `PR #${run.prNumber}` : 'PR') : run.event);

/** Findings shown under one job of the run. */
export const findingsForJob = (run, jobName) => (run.findings ?? []).filter((f) => f.job === jobName);

/** Which job opens by default: the first failed one (BRIEF Flow C step 2). */
export const defaultOpenJob = (run) => run.jobs?.find((j) => j.status === 'failed')?.name ?? null;

/** Note under the job list when findings could not be shown. */
export const findingsNote = (run) => {
  switch (run.findingsState) {
    case 'token_required':
      return 'Findings need a GitHub token (GITHUB_TOKEN in .env). The result comes from the job status.';
    case 'unavailable':
      return "Couldn't read this run's reports. Open the run on GitHub for the details.";
    case 'pending':
      return run.status === 'running' ? 'Findings arrive when the run finishes.' : null;
    default:
      return null;
  }
};

/**
 * How to fix (BRIEF Flow C step 4). Honest about what blocking does: the key
 * is already pushed, so it must be rotated, and Gitleaks scans history, so
 * deleting the line in a new commit doesn't make the run pass.
 */
export const howToFix = (run) => {
  if (run.status === 'blocked' && run.reason === 'secret') {
    const rules = [...new Set((run.findings ?? []).filter((f) => f.tool === 'gitleaks').map((f) => f.ruleId))];
    return {
      title: 'Rotate the key. Blocking the build does not un-leak it.',
      steps: [
        `The commit is already on GitHub, so treat the key as exposed${rules.length ? ` (${rules.join(', ')})` : ''}. Revoke it and issue a new one with its provider.`,
        'Load the new key from the environment, not from code.',
        'Remove the commit that added it from the branch history. Gitleaks scans history, so deleting the line in a new commit still fails.',
      ],
    };
  }
  if (run.status === 'blocked' && run.reason === 'dependency') {
    const pkgs = [...new Set((run.findings ?? []).filter((f) => f.tool === 'npm-audit').map((f) => f.ruleId))];
    return {
      title: 'Upgrade the vulnerable packages.',
      steps: [
        `Run npm audit fix in the affected project${pkgs.length ? ` (${pkgs.join(', ')})` : ''}, or bump the package by hand.`,
        'If no fix exists yet, replace the package or add an override for its patched dependency.',
      ],
    };
  }
  if (run.status === 'blocked' && run.reason === 'image') {
    const images = [...new Set((run.findings ?? []).filter((f) => f.tool === 'trivy').map((f) => f.job.replace(/^image \((.+)\)$/, '$1')))];
    return {
      title: 'Patch the image. Every blocking CVE already has a fix.',
      steps: [
        `Move the Dockerfile${images.length ? ` for ${images.join(', ')}` : ''} to a newer exact base-image tag, and add \`apk upgrade --no-cache\` to patch OS packages that already have fixes.`,
        'For an app package, upgrade it in package.json; drop tools the image does not need at runtime (npm, npx).',
        'Rebuild and scan locally with the same flags: trivy image --severity HIGH,CRITICAL --ignore-unfixed <image>.',
      ],
    };
  }
  if (run.status === 'blocked' && run.reason === 'build') {
    return { title: 'Fix the build.', steps: ['Open the build job on GitHub for the error, fix it and push again.'] };
  }
  if (run.status === 'error') {
    return { title: 'The pipeline failed closed.', steps: ['A check could not finish, so the commit was not let through. Re-run the job on GitHub.'] };
  }
  return null;
};

/** Sync line for the screen; null when everything is fine. */
export const syncMessage = (sync, formatClock) => {
  if (!sync || sync.error === null) return null;
  const since = sync.lastSuccessAt ? ` Last synced ${formatClock(Date.parse(sync.lastSuccessAt))}; showing stored runs.` : ' Showing stored runs.';
  switch (sync.error) {
    case 'poller_off':
      return 'Pipeline polling is off: set GITHUB_REPO for the Defender.';
    case 'token_invalid':
      return `GitHub rejected the token (GITHUB_TOKEN).${since}`;
    case 'rate_limited':
      return `GitHub's rate limit is used up; polling resumes when it resets.${since}`;
    case 'not_found':
      return `GitHub can't find the workflow, or the token can't see the repo.${since}`;
    default:
      return `Can't reach GitHub.${since}`;
  }
};

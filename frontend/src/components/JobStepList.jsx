// A run's jobs in pipeline order (BRIEF §6 S5): status word + icon, name,
// duration. The failing job opens by default and lists its findings, like
// GitHub's own run view (BRIEF §2).

import FindingRow from './FindingRow.jsx';
import { defaultOpenJob, findingsForJob, jobStateLabel } from '../utils/pipelineState.js';
import { formatRunDuration } from '../utils/formatTime.js';

const ICON = {
  passed: <path d="M2 6.5 4.8 9 10 3" />,
  failed: <path d="M3 3l6 6M9 3 3 9" />,
  skipped: <path d="M2.5 9.5 9.5 2.5M6 1.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />,
  running: <path d="M6 1.5a4.5 4.5 0 1 1-4.5 4.5" />,
  queued: <circle cx="6" cy="6" r="4.5" />,
  cancelled: <path d="M2.5 9.5 9.5 2.5M6 1.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />,
};

export default function JobStepList({ run }) {
  const open = defaultOpenJob(run);
  return (
    <ol className="jobs">
      {run.jobs.map((job) => {
        const findings = findingsForJob(run, job.name);
        return (
          <li key={job.name} className={`job job--${job.status}`}>
            <details open={job.name === open || undefined}>
              <summary className="job__summary">
                <svg className="job__icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  {ICON[job.status]}
                </svg>
                <span className="job__name mono">{job.name}</span>
                <span className="job__state">{jobStateLabel(job.status)}</span>
                {findings.length > 0 && (
                  <span className="job__count">
                    {findings.length} finding{findings.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="job__duration">{job.status === 'skipped' ? '' : formatRunDuration(job.durationMs)}</span>
              </summary>
              <div className="job__body">
                {findings.length ? (
                  <ul className="findings">
                    {findings.map((f, i) => (
                      <FindingRow key={`${f.ruleId}:${f.file}:${f.line}:${i}`} finding={f} />
                    ))}
                  </ul>
                ) : (
                  <p className="job__empty">
                    {job.status === 'skipped' ? 'Skipped because an earlier check failed.' : job.status === 'passed' ? 'No findings.' : 'No findings recorded for this job.'}
                    {job.url && (
                      <>
                        {' '}
                        <a href={job.url} target="_blank" rel="noopener noreferrer">
                          Job log on GitHub
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

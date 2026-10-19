// S5 Pipeline (BRIEF §6, Flow C): one card per GitHub Actions run of
// kairo-shield.yml, newest first; the selected run shows its jobs with the
// failing one open, its redacted findings, How to fix and a link to GitHub.
// Runs come from the Defender's GitHub poller and are stored in Mongo, so
// they still show when GitHub (or the venue's internet) is unreachable.
// Routes: /pipeline (newest run selected) and /pipeline/:runId.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

import EmptyState from '../../components/EmptyState.jsx';
import JobStepList from '../../components/JobStepList.jsx';
import RunCard from '../../components/RunCard.jsx';
import RunStateBadge from '../../components/RunStateBadge.jsx';
import { useConsole } from '../../hooks/useConsole.js';
import { useNow } from '../../hooks/useNow.js';
import { usePipeline } from '../../hooks/usePipeline.js';
import { getPipelineRun } from '../../services/api.service.js';
import { findingsNote, howToFix, syncMessage, triggerLabel } from '../../utils/pipelineState.js';
import { formatClock, formatRunDuration } from '../../utils/formatTime.js';

const WORKFLOW = '.github/workflows/kairo-shield.yml';

function RunDetail({ run }) {
  const fix = howToFix(run);
  const note = findingsNote(run);
  const started = run.startedAt ? Date.parse(run.startedAt) : null;
  return (
    <article className="panel run-detail" aria-labelledby="run-title">
      <header className="run-detail__head">
        <RunStateBadge run={run} />
        <h2 id="run-title" className="run-detail__title">
          {run.title ?? 'Untitled run'}
        </h2>
        <p className="run-detail__meta">
          <span className="mono">{run.sha?.slice(0, 7)}</span> · <span className="mono">{run.branch}</span> · {triggerLabel(run)}
          {run.actor ? ` by ${run.actor}` : ''} · started {formatClock(started)}
          {run.durationMs != null ? ` · ${formatRunDuration(run.durationMs)}` : ''}
        </p>
        {run.url && (
          <a className="btn btn--secondary run-detail__github" href={run.url} target="_blank" rel="noopener noreferrer">
            View on GitHub ↗
          </a>
        )}
      </header>

      <h3 className="run-detail__section">Checks</h3>
      <JobStepList key={run._id} run={run} />
      {note && <p className="run-detail__note">{note}</p>}

      {fix && (
        <section className="how-to-fix" aria-labelledby="fix-title">
          <h3 id="fix-title" className="how-to-fix__title">
            How to fix: {fix.title}
          </h3>
          <ol className="how-to-fix__steps">
            {fix.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

export default function Pipeline() {
  const { connection } = useConsole();
  const stale = connection !== 'live';
  const now = useNow(stale);
  const { runId } = useParams();
  const { runs, sync, loaded, error } = usePipeline(connection);
  const [extra, setExtra] = useState(null); // a run linked directly but older than the list

  const wanted = runId ? Number(runId) : null;
  const listed = wanted ? runs.find((r) => r._id === wanted) : runs[0];
  const selected = listed ?? (extra?._id === wanted ? extra : null);

  useEffect(() => {
    if (!wanted || !loaded || listed || extra?._id === wanted) return;
    let live = true;
    getPipelineRun(wanted)
      .then((d) => live && setExtra(d.run))
      .catch(() => live && setExtra({ _id: wanted, missing: true }));
    return () => {
      live = false;
    };
  }, [wanted, loaded, listed, extra]);

  const syncText = syncMessage(sync, formatClock);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Pipeline
      </h1>

      {syncText && (
        <p className="pipeline__sync" role="status">
          {syncText}
        </p>
      )}
      {sync && sync.error === null && !sync.tokenConfigured && (
        <p className="pipeline__sync pipeline__sync--info">No GitHub token: pass/fail only, refreshed every 2 minutes.</p>
      )}

      {error && !loaded ? (
        <div className="panel">
          <EmptyState hint={error.message}>Could not load pipeline runs.</EmptyState>
        </div>
      ) : !loaded ? (
        <div className="panel">
          <div className="skeleton skeleton--block" aria-label="Loading pipeline runs" />
        </div>
      ) : runs.length === 0 && !selected ? (
        <div className="panel">
          <EmptyState hint={`Workflow: ${WORKFLOW}`}>No runs yet. Push a commit to any branch to run the security checks.</EmptyState>
        </div>
      ) : (
        <div className="pipeline-grid">
          <nav className="panel pipeline__runs" aria-label="Pipeline runs">
            <ul className="run-list">
              {runs.map((r) => (
                <RunCard key={r._id} run={r} selected={selected?._id === r._id} now={now} />
              ))}
            </ul>
          </nav>
          {selected && !selected.missing ? (
            <RunDetail run={selected} />
          ) : wanted && !selected ? (
            <div className="panel">
              <div className="skeleton skeleton--block" aria-label="Loading pipeline run" />
            </div>
          ) : (
            <div className="panel">
              <EmptyState hint="It may be older than 90 days.">This pipeline run isn't stored.</EmptyState>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

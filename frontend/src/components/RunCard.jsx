// One pipeline run in the S5 list (BRIEF §6): state, trigger, commit subject,
// short SHA and branch, then when and how long. The whole card is a link to
// /pipeline/:runId.

import { Link } from 'react-router';

import RunStateBadge from './RunStateBadge.jsx';
import { triggerLabel } from '../utils/pipelineState.js';
import { formatAgo, formatRunDuration } from '../utils/formatTime.js';

export default function RunCard({ run, selected, now }) {
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : null;
  return (
    <li>
      <Link to={`/pipeline/${run._id}`} className={`run-card${selected ? ' run-card--selected' : ''}`} aria-current={selected ? 'page' : undefined}>
        <span className="run-card__top">
          <RunStateBadge run={run} />
          <span className="run-card__trigger">{triggerLabel(run)}</span>
          <span className="run-card__ago">{formatAgo(finished ?? Date.parse(run.startedAt), now)}</span>
        </span>
        <span className="run-card__title">{run.title ?? 'Untitled run'}</span>
        <span className="run-card__meta mono">
          {run.sha?.slice(0, 7)} · {run.branch}
          {run.status !== 'running' && <> · {formatRunDuration(run.durationMs)}</>}
        </span>
      </Link>
    </li>
  );
}

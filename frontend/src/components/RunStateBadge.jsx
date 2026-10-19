// Pipeline run state (BRIEF §10: state word + icon, never colour alone).
// Square corners on purpose: full radius belongs to ActionPill ("what Kairo
// did"); this says what the pipeline decided about a commit.

import { runStateLabel } from '../utils/pipelineState.js';

export const STATE_ICONS = {
  // Check
  passed: <path d="M2 6.5 4.8 9 10 3" />,
  // Octagon with a bar: stopped
  blocked: <path d="M4.5 1h3L11 4.5v3L7.5 11h-3L1 7.5v-3Z M3.5 6h5" />,
  // Open circle: in progress
  running: <path d="M6 1.5a4.5 4.5 0 1 1-4.5 4.5" />,
  // Triangle with a bang
  error: <path d="M6 1.5 11 10.5H1Z M6 5v2.5 M6 9v.01" />,
};

export default function RunStateBadge({ run }) {
  return (
    <span className={`run-state run-state--${run.status}`}>
      <svg className="run-state__icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        {STATE_ICONS[run.status]}
      </svg>
      <span>{runStateLabel(run)}</span>
    </span>
  );
}

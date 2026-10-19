// Vertical timeline (BRIEF §7): each step has a time, a label and, for
// actions, its latencies in ms. The marker's shape follows the step kind, so
// it never depends on colour alone.

import { formatClock } from '../utils/formatTime.js';

const MARKER = { signal: '◆', action: '●', skipped: '◇', failed: '▲', resolved: '✓', pending: '○' };

export default function Timeline({ steps }) {
  return (
    <ol className="timeline">
      {steps.map((s, i) => (
        <li key={`${s.at}-${i}`} className={`timeline__step timeline__step--${s.kind}`}>
          <span className="timeline__marker" aria-hidden="true">
            {MARKER[s.kind] ?? '•'}
          </span>
          <span className="timeline__time mono">{formatClock(s.at)}</span>
          <span className="timeline__label">
            {s.kind === 'pending' ? `${s.label} at ${formatClock(s.at)}` : s.label}
          </span>
          {s.detail && <span className="timeline__detail">{s.detail}</span>}
          {Number.isFinite(s.remediateMs) && (
            <span className="timeline__latency mono">
              detect {s.detectMs} ms · remediate {s.remediateMs} ms
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

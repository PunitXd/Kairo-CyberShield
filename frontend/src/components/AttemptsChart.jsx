// Attempts over time for one incident's source (PHASES Oct 22 #5; the
// "Attempts velocity" chart in Stitch 03-incident-detail, without its invented
// labels). The line is the rolling count in the rule's window, what the rule
// compares with its dashed threshold; faint bars are attempts per step; a
// marker sits where each action fired ("R1a · Throttled"). Hand-written SVG,
// no animation, colours from tokens.css.

import { formatClock } from '../utils/formatTime.js';
import { formatWindow, incidentMarkers, niceMax } from '../utils/liveRates.js';

const W = 432;
const H = 150;
const PAD = { top: 26, right: 8, bottom: 20, left: 8 };
const UNIT = { R1a: 'failed logins', R2a: 'wrong room codes', R3a: 'weighted socket events' };

export default function AttemptsChart({ series, actions }) {
  const { points, threshold, windowMs, from, to, stepMs, ruleId } = series;
  const until = Math.max(series.until ?? to, to); // the axis end: at least one window, so a live attack doesn't hug the edge
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + ((t - from) / Math.max(1, until - from)) * plotW;
  const yMax = niceMax(points.map((p) => p.w), threshold);
  const y = (v) => PAD.top + plotH - (Math.min(v, yMax) / yMax) * plotH;
  const peak = Math.max(0, ...points.map((p) => p.w));
  const unit = UNIT[ruleId] ?? 'attempts';
  const barW = Math.max(1, (stepMs / Math.max(1, until - from)) * plotW - 1);

  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  const markers = incidentMarkers(actions).filter((m) => m.t >= from && m.t <= to);
  let rowEnd = [-Infinity, -Infinity];
  const placed = markers.map((m) => {
    const mx = x(m.t);
    const right = mx > W * 0.6;
    const width = m.label.length * 6.2;
    const left = right ? mx - 4 - width : mx + 4;
    const row = rowEnd.findIndex((end) => left > end + 4);
    if (row !== -1) rowEnd[row] = left + width;
    return { ...m, mx, right, row };
  });
  rowEnd = null;

  return (
    <figure className="attempts">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="attempts__svg"
        role="img"
        aria-label={`${unit} from this source in a rolling ${formatWindow(windowMs)} window: peak ${peak}, threshold ${threshold}. ${markers.length} action${markers.length === 1 ? '' : 's'} marked.`}
      >
        {points.map((p) =>
          p.n > 0 ? <rect key={p.t} className="attempts__bar" x={x(p.t) - barW} y={y(p.n)} width={barW} height={PAD.top + plotH - y(p.n)} /> : null
        )}
        <line className="attempts__base" x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
        <line className="live__threshold" x1={PAD.left} x2={W - PAD.right} y1={y(threshold)} y2={y(threshold)} />
        <text className="attempts__limit" x={W - PAD.right} y={y(threshold) - 4} textAnchor="end">
          {ruleId} acts at {threshold}
        </text>
        {placed.map((m) => (
          <g key={`${m.t}:${m.label}`} className="live__marker">
            <line x1={m.mx} x2={m.mx} y1={PAD.top - 6} y2={PAD.top + plotH} />
            {m.row !== -1 && (
              <text x={m.right ? m.mx - 4 : m.mx + 4} y={10 + m.row * 12} textAnchor={m.right ? 'end' : 'start'}>
                {m.label}
              </text>
            )}
          </g>
        ))}
        {points.length > 1 && <polyline className={`live__line${peak >= threshold ? ' live__line--over' : ''}`} points={line} />}
        <text className="attempts__axis" x={PAD.left} y={H - 4}>
          {formatClock(from)}
        </text>
        {until > to + 1000 && (
          <line className="attempts__now" x1={x(to)} x2={x(to)} y1={PAD.top} y2={PAD.top + plotH} />
        )}
        <text className="attempts__axis" x={W - PAD.right} y={H - 4} textAnchor="end">
          {formatClock(until)}
        </text>
        {until > to + 1000 && (
          <text className="attempts__axis" x={x(to)} y={H - 4} textAnchor="middle">
            now
          </text>
        )}
      </svg>
      <figcaption className="attempts__caption">
        Line: {unit} from this source in the last {formatWindow(windowMs)} (peak {peak}). Bars: per {formatWindow(stepMs)}. Dashed: {ruleId} acts at {threshold}.
      </figcaption>
    </figure>
  );
}

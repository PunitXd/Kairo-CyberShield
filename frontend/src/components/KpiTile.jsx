// One KPI (BRIEF §7): label, a big tabular number, an optional hint.
// States: loading (skeleton), live, stale (hatched + "as of"), empty ("—" + hint).
// Tiles with a destination are links (BRIEF §10 focus order). An optional
// `spark` ({ values, label }) draws a 5-minute sparkline under the number.

import { Link } from 'react-router';

import Sparkline from './Sparkline.jsx';
import { formatClock } from '../utils/formatTime.js';

export default function KpiTile({ label, value, hint, to, state = 'live', asOf, spark }) {
  const body = (
    <>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value" aria-busy={state === 'loading' || undefined}>
        {state === 'loading' ? <span className="skeleton" aria-label="Loading" /> : value}
      </span>
      {spark && state !== 'loading' && <Sparkline values={spark.values} label={spark.label} />}
      <span className="kpi__hint">{state === 'stale' ? `as of ${formatClock(asOf)}` : hint}</span>
    </>
  );
  const className = `kpi kpi--${state}`;
  return to ? (
    <Link to={to} className={`${className} kpi--link`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

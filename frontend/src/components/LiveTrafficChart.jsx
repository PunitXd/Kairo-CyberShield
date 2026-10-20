// Live traffic chart (PHASES Oct 21 #2; the big chart on the Stitch Overview).
// Three stacked panels on one 5-minute time axis, one point per second:
// failed logins, room-code misses, socket events. Each draws the busiest
// source's count in its rule's window against a dashed threshold line, with a
// faint area of that panel's events/s behind it for context, and a marker
// wherever Kairo acted ("R1b · Blocked").
//
// Hand-written SVG. The paths are drawn in fixed time coordinates and the
// group slides left one step per second with a 1 s linear transform, so the
// chart scrolls smoothly without animating any point; prefers-reduced-motion
// turns the slide off (components.css). Colours come from tokens.css only.

import { useEffect, useRef, useState } from 'react';

import { HISTORY_MS, PANELS, formatWindow, niceMax, panelAriaLabel, panelSeries } from '../utils/liveRates.js';

const HEIGHT = 84;
const PAD_Y = 8;
const GUTTER = 92; // right end: the current value ("27.25 of 30")
const AXIS_TICKS = [5, 4, 3, 2, 1, 0]; // minutes ago
const LABEL_CHAR_PX = 6.7; // 11 px mono
const REPEAT_QUIET_MS = 30_000; // the same label again within 30 s: line only

// Every marker gets its line; a label only where it fits on one of two rows
// and doesn't just repeat a newer one (R1a re-throttling every few seconds
// would otherwise stack "R1a · Throttled" four times). Labels sit LEFT of
// their line, newest first, so a marker that just landed at the right edge is
// readable at once instead of being clipped until it scrolls in.
const placeLabels = (markers, x) => {
  const rowStart = [Infinity, Infinity];
  const newerAt = new Map();
  const placed = [];
  for (const m of [...markers].reverse()) {
    const mx = x(m.t);
    const repeat = newerAt.has(m.label) && newerAt.get(m.label) - m.t < REPEAT_QUIET_MS;
    newerAt.set(m.label, m.t);
    const row = repeat ? -1 : rowStart.findIndex((start) => mx - 4 < start - 8);
    if (row !== -1) rowStart[row] = mx - 4 - m.label.length * LABEL_CHAR_PX;
    placed.push({ ...m, mx, row: row === -1 ? null : row });
  }
  return placed;
};

const useWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
};

function ChartPanel({ panel, series, width, tBase, tEnd }) {
  const plotW = Math.max(0, width - GUTTER);
  const step = plotW / (HISTORY_MS / 1000);
  const x = (t) => ((t - tBase) / 1000) * step;
  const shift = plotW - x(tEnd);
  const inner = HEIGHT - 2 * PAD_Y;

  const yMax = niceMax(series.points.map((p) => p.peak), series.threshold ?? 0);
  const y = (v) => PAD_Y + inner - (Math.min(v, yMax) / yMax) * inner;
  const cMax = Math.max(1, ...series.points.map((p) => p.context));
  const yc = (v) => HEIGHT - (v / cMax) * inner * 0.6;

  const pts = series.points;
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.peak).toFixed(1)}`).join(' ');
  const area = pts.length
    ? `M${x(pts[0].t).toFixed(1)},${HEIGHT} ` +
      pts.map((p) => `L${x(p.t).toFixed(1)},${yc(p.context).toFixed(1)}`).join(' ') +
      ` L${x(pts.at(-1).t).toFixed(1)},${HEIGHT} Z`
    : '';
  const over = series.threshold !== null && series.current >= series.threshold;
  const clipId = `live-clip-${panel.id}`;
  const label = panelAriaLabel(panel, series);
  const shadow = series.mode && series.mode !== 'enforce';

  return (
    <figure className="live__panel">
      <figcaption className="live__caption">
        <span className="live__title">{panel.title}</span>
        <span className="live__desc">
          Busiest source{series.windowMs ? `, last ${formatWindow(series.windowMs)}` : ''} · dashed line: {panel.ruleId} acts at {series.threshold ?? '—'}
          {shadow ? ` (${series.mode})` : ''} · shaded: all {panel.title.toLowerCase()} per second
        </span>
      </figcaption>
      <svg className="live__svg" width={width} height={HEIGHT} role="img" aria-label={label}>
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={plotW} height={HEIGHT} />
          </clipPath>
        </defs>
        <line className="live__base" x1="0" x2={plotW} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} />
        <g clipPath={`url(#${clipId})`}>
          <g className="live__scroll" style={{ transform: `translateX(${shift.toFixed(1)}px)` }}>
            {area && <path className="live__context" d={area} />}
            {placeLabels(series.markers, x).map((m) => (
              <g key={`${m.t}:${m.label}`} className="live__marker">
                <line x1={m.mx} x2={m.mx} y1={0} y2={HEIGHT} />
                {m.row !== null && (
                  <text x={m.mx - 4} y={12 + m.row * 13} textAnchor="end">
                    {m.label}
                  </text>
                )}
              </g>
            ))}
            {pts.length > 1 && <polyline className={`live__line${over ? ' live__line--over' : ''}`} points={line} />}
          </g>
          {series.threshold !== null && (
            <line className="live__threshold" x1="0" x2={plotW} y1={y(series.threshold)} y2={y(series.threshold)} />
          )}
        </g>
        <text className={`live__value${over ? ' live__value--over' : ''}`} x={plotW + 8} y={Math.max(14, Math.min(HEIGHT - 4, y(series.current) + 5))}>
          {series.current}
          {series.threshold !== null && <tspan className="live__limit"> of {series.threshold}</tspan>}
        </text>
      </svg>
    </figure>
  );
}

export default function LiveTrafficChart({ samples, loaded, paused }) {
  const [ref, width] = useWidth();
  const tBase = useRef(null);
  if (tBase.current === null && samples.length) tBase.current = samples[0].t;
  const tEnd = samples.at(-1)?.t ?? 0;
  const plotW = Math.max(0, width - GUTTER);

  return (
    <section className="panel live" aria-labelledby="live-title">
      <div className="live__head">
        <h2 id="live-title" className="panel__title">
          Live traffic
        </h2>
        <span className="live__note">{paused ? 'Paused with the activity stream' : 'Last 5 min · one point per second'}</span>
      </div>
      <div ref={ref} className="live__body">
        {!loaded ? (
          <p className="live__empty">Waiting for the first second of data…</p>
        ) : (
          width > 0 &&
          PANELS.map((panel) => (
            <ChartPanel key={panel.id} panel={panel} series={panelSeries(samples, panel)} width={width} tBase={tBase.current} tEnd={tEnd} />
          ))
        )}
        {loaded && width > 0 && (
          <div className="live__axis" style={{ width: plotW }} aria-hidden="true">
            {AXIS_TICKS.map((m) => (
              <span key={m} style={{ left: `${((5 - m) / 5) * 100}%` }}>
                {m === 0 ? 'now' : `−${m} min`}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

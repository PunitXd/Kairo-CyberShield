// Pure helpers for the Overview's live monitoring (PHASES Oct 21 #2): the
// Live traffic chart's three panels, the KPI sparklines, the status line and
// the activity stream. Input is the `rates.tick` samples ({ t, counts, total,
// peaks, lastEventAt, actions? }, oldest first) and raw stream events.

export const HISTORY_MS = 300_000; // the chart shows the last 5 minutes
export const SILENT_AFTER_MS = 60_000; // status line warns after 60 s with no events

const VERB = { block: 'Blocked', throttle: 'Throttled', disconnect: 'Disconnected', knock_mode: 'Knock mode' };

const isSocketType = (type) => type.startsWith('socket.');

// One panel per charted rule. `peak` is the busiest source's count in that
// rule's window; `context` is the panel's own event types per second.
export const PANELS = [
  {
    id: 'auth',
    ruleId: 'R1a',
    title: 'Failed logins',
    unit: 'failed logins from one source',
    family: 'R1',
    contextTypes: (type) => type === 'auth.fail',
  },
  {
    id: 'room',
    ruleId: 'R2a',
    title: 'Room-code misses',
    unit: 'wrong room codes from one source',
    family: 'R2',
    contextTypes: (type) => type === 'room.join.invalid',
  },
  {
    id: 'socket',
    ruleId: 'R3a',
    title: 'Socket events',
    unit: 'weighted socket events from one socket',
    family: 'R3',
    contextTypes: isSocketType,
  },
];

/** 60000 → "60 s", 600000 → "10 min". */
export const formatWindow = (ms) => (ms >= 120_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

/** { ruleId: 'R1b', type: 'block' } → "R1b · Blocked". */
export const markerLabel = (action) => `${action.ruleId} · ${VERB[action.type] ?? action.type}`;

const sumCounts = (counts, match) => Object.entries(counts ?? {}).reduce((n, [type, c]) => (match(type) ? n + c : n), 0);

/**
 * One panel's series from the samples.
 * @returns {{ points: Array<{ t, peak, context }>, threshold, windowMs, mode, current, markers: Array<{ t, label }> }}
 */
export const panelSeries = (samples, panel) => {
  const points = [];
  const markers = [];
  let threshold = null;
  let windowMs = null;
  let mode = null;
  for (const s of samples) {
    const p = s.peaks?.[panel.ruleId];
    if (p) {
      threshold = p.threshold;
      windowMs = p.windowMs;
      mode = p.mode;
    }
    points.push({ t: s.t, peak: p?.value ?? 0, context: sumCounts(s.counts, panel.contextTypes) });
    const labels = (s.actions ?? []).filter((a) => a.ruleId?.startsWith(panel.family)).map(markerLabel);
    if (labels.length) markers.push({ t: s.t, label: [...new Set(labels)].join(', ') });
  }
  return { points, threshold, windowMs, mode, current: points.at(-1)?.peak ?? 0, markers };
};

/** A round top for a y-scale that always shows the threshold line with headroom. */
export const niceMax = (values, threshold = 0) => {
  const max = Math.max(1, threshold * 1.25, ...values.map((v) => v * 1.1));
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= max) ?? 10;
  return step * pow;
};

/** The panel's aria-label: its current value and threshold, in words. */
export const panelAriaLabel = (panel, series) => {
  const window = series.windowMs ? ` in the last ${formatWindow(series.windowMs)}` : '';
  const limit = series.threshold !== null ? `, threshold ${series.threshold}` : '';
  const shadow = series.mode && series.mode !== 'enforce' ? ` (${series.mode})` : '';
  return `${panel.title}: busiest source ${series.current} ${panel.unit.replace(/ from one (source|socket)$/, '')}${window}${limit}${shadow}.`;
};

/** Values for a KPI sparkline: one bucket per `bucketMs`, oldest first. */
export const sparkSeries = (samples, pick, { bucketMs = 10_000, now = samples.at(-1)?.t ?? 0, spanMs = HISTORY_MS } = {}) => {
  const n = Math.ceil(spanMs / bucketMs);
  const start = now + 1000 - n * bucketMs; // the newest (current) second is in the last bucket
  const out = Array(n).fill(0);
  for (const s of samples) {
    const i = Math.floor((s.t - start) / bucketMs);
    if (i >= 0 && i < n) out[i] += pick(s);
  }
  return out;
};

export const DENIAL_TYPES = new Set(['http.denied', 'room.join.denied', 'room.hit_while_flagged']);
export const pickTotal = (s) => s.total ?? 0;
export const pickActions = (s) => s.actions?.length ?? 0;
export const pickDenials = (s) => sumCounts(s.counts, (type) => DENIAL_TYPES.has(type));

/** "0.4 s ago", "12 s ago", "3 min ago". */
export const formatSince = (ms) => {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s ago`;
  if (ms < 120_000) return `${Math.floor(ms / 1000)} s ago`;
  return `${Math.floor(ms / 60_000)} min ago`;
};

/**
 * The status line under the KPI strip:
 *   "Watching cypherfy-backend-1 · 37 events/s · last event 0.4 s ago · 8 rules in Enforce"
 * and a warning after 60 s without an event.
 * @returns {{ tone: 'ok'|'warning', text: string }}
 */
export const statusLine = ({ samples, status, now }) => {
  const hooks = status?.hooks ?? [];
  const watching = hooks.length ? hooks.map((h) => h.inst).join(', ') : 'CypherFy';
  const lastFromHooks = Math.max(0, ...hooks.map((h) => h.lastEventAt ?? 0));
  const lastFromTicks = Math.max(0, ...samples.slice(-5).map((s) => s.lastEventAt ?? 0));
  const lastEventAt = Math.max(lastFromHooks, lastFromTicks) || null;
  const enforcing = (status?.rules ?? []).filter((r) => r.mode === 'enforce').length;
  const rulesText = `${enforcing} rule${enforcing === 1 ? '' : 's'} in Enforce`;
  const silentMs = lastEventAt ? now - lastEventAt : Infinity;
  if (silentMs >= SILENT_AFTER_MS) {
    const quiet = lastEventAt ? `No events for ${formatSince(silentMs).replace(' ago', '')}` : 'No events yet';
    return { tone: 'warning', text: `${quiet} from ${watching}. Is CypherFy running? · ${rulesText}` };
  }
  const rate = samples.at(-1)?.total ?? 0;
  return { tone: 'ok', text: `Watching ${watching} · ${rate} event${rate === 1 ? '' : 's'}/s · last event ${formatSince(silentMs)} · ${rulesText}` };
};

/**
 * One activity-stream row from a raw event, hashes only.
 * @returns {{ key, ts, type, sourceKind, source, detail }}
 */
export const describeEvent = (e) => {
  let detail = '';
  if (e.auth) detail = `${e.auth.route} · ${e.auth.status}`;
  else if (e.room) detail = `room ${e.room.kind} · ${e.room.via}${e.room.error ? ` · ${e.room.error}` : ''}`;
  else if (e.http) detail = `${e.http.scope} · ${e.http.rule}`;
  else if (e.sock?.counts) detail = `${e.sock.total} packets: ${Object.keys(e.sock.counts).slice(0, 3).join(', ')}`;
  else if (e.sock?.event) detail = `bad payload · ${e.sock.event}`;
  else if (e.ack) detail = e.ack.ok ? 'command done' : 'command failed';
  return {
    key: `${e.ts}:${e.type}:${e.src?.ipHash}:${e.src?.socketId ?? ''}:${detail}`,
    ts: e.ts,
    type: e.type,
    sourceKind: 'ip',
    source: e.src?.ipHash ?? null,
    detail,
  };
};

/** How many of `latest` (newest first) are newer than what is on screen. */
export const countNew = (shown, latest) => {
  if (!shown.length) return latest.length;
  const keys = new Set(shown.map((r) => r.key));
  const newestShown = shown[0].ts;
  return latest.filter((r) => !keys.has(r.key) && r.ts >= newestShown).length;
};

const MARKED_RESULTS = new Set(['applied', 'already_active', 'sent', 'skipped_shadow']);

/** An incident's own actions as chart markers (drawer chart): what Kairo did, and when. */
export const incidentMarkers = (actions = []) =>
  actions
    .filter((a) => MARKED_RESULTS.has(a.result) && a.type !== 'flag')
    .map((a) => ({
      t: Date.parse(a.appliedAt ?? a.requestedAt),
      label: `${markerLabel(a)}${a.result === 'skipped_shadow' ? ' (shadow)' : ''}`,
    }))
    .filter((m) => Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);

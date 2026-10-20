// Live rates for the console graphs (ARCH §6.4, §9.3; PHASES Oct 20 #7).
//
// Every second a `rates.tick` sample: event counts per type for that second,
// and for the charted rules (R1a, R2a, R3a) the **peak** — the highest window
// count of any single source (or socket, for R3a) right now. Thresholds are
// per source per window, so only the peak can be drawn against a threshold.
//
// The peaks come from windows kept here, separate from the rules' own: a rule
// resets its window when it fires (so it doesn't re-fire), which would make
// the chart line drop to zero at the moment of action. These windows never
// reset, so the line climbs to the threshold, stops rising once the source is
// blocked, and falls as its window empties. They reuse each rule's own subject,
// windowKey and measure, so a peak means exactly what the rule counts.
//
// Each enforced action (from the bus's action.applied) is attached to the
// second it landed in, as { ruleId, type, scope }, so the chart can draw a
// marker there ("R1b · Blocked") — from history too, after a reload. Socket
// actions arrive twice (sent, then applied on ack); each id is drawn once.
//
// The last 5 minutes stay in memory for GET /api/rates, so a freshly opened
// dashboard starts with a full chart.
//
// Per source, the same measure is also kept in 1-second buckets for
// SERIES_RETENTION_MS (PHASES Oct 22 #5): the incident drawer's attempts chart
// reads it through seriesFor(). Hashes and counts only; sources idle for the
// retention period are dropped, and at most SERIES_MAX_SUBJECTS are kept (the
// least recently active goes first), so a flood from many IPs can't grow it.

import { WindowStore } from '../utils/WindowStore.js';

export const CHARTED_RULES = ['R1a', 'R2a', 'R3a'];
export const HISTORY_SEC = 300;
const SWEEP_MS = 30_000;
export const SERIES_RETENTION_MS = 15 * 60_000;
export const SERIES_MAX_SUBJECTS = 1000;
/** Which charted rule tells an incident family's attempts story. */
export const SERIES_RULE_BY_FAMILY = { auth: 'R1a', room: 'R2a', socket: 'R3a' };
const MARKED_RESULTS = new Set(['applied', 'already_active', 'sent']);
const MARKED_TYPES = new Set(['block', 'throttle', 'disconnect', 'knock_mode']); // not flag: internal bookkeeping
const SEEN_IDS_MAX = 500;

export const createRates = ({ rules, getConfig, bus = null, now = Date.now, tickMs = 1000, autoTick = true }) => {
  const charted = rules.filter((r) => CHARTED_RULES.includes(r.id));
  const windows = new WindowStore();
  const history = []; // samples, oldest first
  let counts = {};
  let lastEventAt = null;
  let lastSweep = now();
  let actions = [];
  const seenIds = new Set();
  const series = new Map(); // `${ruleId}|${subject}` → { last, buckets: Map<secondMs, value> }

  const addToSeries = (ruleId, subject, value, ts) => {
    const key = `${ruleId}|${subject}`;
    let entry = series.get(key);
    if (!entry) {
      if (series.size >= SERIES_MAX_SUBJECTS) {
        let oldestKey = null;
        let oldest = Infinity;
        for (const [k, e] of series) if (e.last < oldest) [oldest, oldestKey] = [e.last, k];
        series.delete(oldestKey);
      }
      entry = { last: ts, buckets: new Map() };
      series.set(key, entry);
    }
    const sec = Math.floor(ts / 1000) * 1000;
    entry.buckets.set(sec, (entry.buckets.get(sec) ?? 0) + value);
    entry.last = Math.max(entry.last, ts);
  };

  const sweepSeries = (t) => {
    for (const [key, entry] of series) {
      if (entry.last < t - SERIES_RETENTION_MS) {
        series.delete(key);
        continue;
      }
      for (const sec of entry.buckets.keys()) if (sec < t - SERIES_RETENTION_MS) entry.buckets.delete(sec);
    }
  };

  /** Remember one action for the current second's marker (bus: action.applied). */
  const recordAction = (a) => {
    if (!a || !MARKED_RESULTS.has(a.result) || !MARKED_TYPES.has(a.type)) return;
    if (a._id) {
      if (seenIds.has(a._id)) return;
      seenIds.add(a._id);
      if (seenIds.size > SEEN_IDS_MAX) seenIds.delete(seenIds.values().next().value);
    }
    actions.push({ ruleId: a.ruleId, type: a.type, scope: a.scope });
  };
  bus?.on('action.applied', recordAction);

  /** Count one validated event (call for every event the consumer accepts). */
  const record = (event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    lastEventAt = Math.max(lastEventAt ?? 0, event.ts);
    const config = getConfig();
    for (const rule of charted) {
      if (!rule.on.includes(event.type)) continue;
      const cfg = config.rules[rule.id];
      if (!cfg) continue;
      const subject = rule.subject(event);
      if (!subject) continue;
      try {
        const measured = rule.measure(event, cfg);
        windows.add(rule.id, rule.windowKey?.(event) ?? subject, measured, event.ts, cfg.windowMs);
        addToSeries(rule.id, subject, measured.value, event.ts);
      } catch {
        /* a chart must never break event processing */
      }
    }
  };

  /** Close the current second: build the sample, keep it, push it. */
  const tick = () => {
    const t = now();
    const config = getConfig();
    const peaks = {};
    for (const rule of charted) {
      const cfg = config.rules[rule.id];
      if (!cfg) continue;
      peaks[rule.id] = { value: Math.round(windows.peak(rule.id, cfg.windowMs, t) * 100) / 100, threshold: cfg.threshold, windowMs: cfg.windowMs, mode: cfg.mode };
    }
    const sample = {
      t: Math.floor(t / 1000) * 1000,
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      peaks,
      lastEventAt,
      ...(actions.length ? { actions } : {}),
    };
    counts = {};
    actions = [];
    history.push(sample);
    while (history.length && history[0].t < sample.t - HISTORY_SEC * 1000) history.shift();
    if (t - lastSweep >= SWEEP_MS) {
      windows.sweep(t);
      sweepSeries(t);
      lastSweep = t;
    }
    bus?.emit('rates.tick', sample);
    return sample;
  };

  const timer = autoTick ? setInterval(tick, tickMs) : null;
  timer?.unref?.();

  return {
    record,
    recordAction,
    tick,
    /**
     * One source's attempts for one charted rule, every stepMs from `from` to
     * `to`: n = the measure inside that step, w = inside the rule's window
     * ending there (what the rule compares with its threshold).
     * @returns {{ available: boolean, points: Array<{ t, n, w }>, oldestMs: number|null }}
     */
    seriesFor: (ruleId, subject, { from, to, stepMs, windowMs }) => {
      const entry = series.get(`${ruleId}|${subject}`);
      if (!entry || !entry.buckets.size) return { available: false, points: [], oldestMs: null };
      const buckets = [...entry.buckets].sort((a, b) => a[0] - b[0]);
      const sum = (lo, hi) => buckets.reduce((acc, [sec, v]) => (sec > lo && sec <= hi ? acc + v : acc), 0);
      const points = [];
      const start = Math.ceil(from / stepMs) * stepMs;
      for (let t = start; t <= to; t += stepMs) {
        points.push({ t, n: Math.round(sum(t - stepMs, t) * 100) / 100, w: Math.round(sum(t - windowMs, t) * 100) / 100 });
      }
      return { available: points.some((p) => p.n > 0 || p.w > 0), points, oldestMs: buckets[0][0] };
    },
    /** Samples from the last windowSec seconds, oldest first. */
    history: (windowSec = HISTORY_SEC) => history.filter((s) => s.t >= now() - windowSec * 1000),
    stop: () => {
      if (timer) clearInterval(timer);
      bus?.off('action.applied', recordAction);
    },
  };
};

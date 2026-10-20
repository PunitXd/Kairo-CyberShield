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

import { WindowStore } from '../utils/WindowStore.js';

export const CHARTED_RULES = ['R1a', 'R2a', 'R3a'];
export const HISTORY_SEC = 300;
const SWEEP_MS = 30_000;
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
        windows.add(rule.id, rule.windowKey?.(event) ?? subject, rule.measure(event, cfg), event.ts, cfg.windowMs);
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
    /** Samples from the last windowSec seconds, oldest first. */
    history: (windowSec = HISTORY_SEC) => history.filter((s) => s.t >= now() - windowSec * 1000),
    stop: () => {
      if (timer) clearInterval(timer);
      bus?.off('action.applied', recordAction);
    },
  };
};

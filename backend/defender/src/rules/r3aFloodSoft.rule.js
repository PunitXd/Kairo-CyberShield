// R3a — Socket.io event flood, soft step (PRD F4).
// Signal: socket.rate (one packet summary per socket per second). Counted per
// socket, weighted: WebRTC signalling (ICE candidates, offers, answers) counts
// a quarter, because a normal call start sends dozens of them (ARCH §6.2).
// Threshold/window from config (30 in 10 s). Action: throttle that socket in
// the hooks (maxPerSec for throttleMs, renewed while the rule keeps firing);
// excess packets are dropped and the client gets SLOW_DOWN. Severity low
// (BRIEF D9). Its firings count toward R3b.

import { describeWindow } from '../utils/describeWindow.js';

/** Packets in one socket.rate summary, with the configured per-event weights. */
export const weightedTotal = (counts, weights = {}) =>
  Object.entries(counts).reduce((n, [name, c]) => n + c * (Object.hasOwn(weights, name) ? weights[name] : 1), 0);

/** The busiest event names in a summary, for the incident's evidence. */
export const topEvents = (counts, n = 5) =>
  Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n));

export const r3aFloodSoft = {
  id: 'R3a',
  family: 'socket',
  version: 1,
  on: ['socket.rate'],
  subject: (e) => e.src.ipHash,
  windowKey: (e) => `socket:${e.src.socketId}`,
  measure: (e, cfg) => ({ value: weightedTotal(e.sock.counts, cfg.signalWeight) }),
  evaluate(state, cfg, e) {
    const weighted = state.sum('R3a', cfg.windowMs);
    if (weighted < cfg.threshold) return null;
    const observed = Math.round(weighted);
    return {
      severity: 'low',
      summary: `${observed} socket events in ${describeWindow(cfg.windowMs)} from one connection`,
      actions: [{ type: 'throttle', scope: 'socket', ttlMs: cfg.throttleMs, params: { socketId: e.src.socketId, maxPerSec: cfg.maxPerSec } }],
      evidence: { observed, threshold: cfg.threshold, windowMs: cfg.windowMs, histogram: topEvents(e.sock.counts) },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'src.socketId', 'sock.counts', 'sock.total'],
    };
  },
};

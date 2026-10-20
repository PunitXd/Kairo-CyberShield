// R3c — connection flood (PRD F4).
// Signal: socket.connect per source. Threshold/window from config (20 new
// handshakes in 60 s). Reconnects by the same session within
// reconnectCollapseMs (5 s) count once, so a flaky network or a page reload
// doesn't look like a flood; the session is the hashed session or account id,
// and guests without one count every handshake. Action: block the `socket`
// scope for ttlMs (10 min): new handshakes are refused, already-open sockets
// stay up. Severity high (BRIEF D9).
//
// The post-deploy threshold multiplier in ARCH §6.2 waits for R4 (Oct 22),
// which is what knows a deploy just happened.

import { describeWindow } from '../utils/describeWindow.js';

const lastSeen = new Map(); // `${ipHash}|${session}` → ts of its last counted handshake
const PRUNE_EVERY = 1000;
let added = 0;

const sessionOf = (e) => e.src.sessionKey ?? e.src.userHash ?? null;

export const r3cConnFlood = {
  id: 'R3c',
  name: 'Connection flood',
  family: 'socket',
  version: 1,
  on: ['socket.connect'],
  subject: (e) => e.src.ipHash,
  measure(e, cfg) {
    const session = sessionOf(e);
    if (!session) return { value: 1, distinct: `socket:${e.src.socketId}` };
    const key = `${e.src.ipHash}|${session}`;
    const prev = lastSeen.get(key);
    lastSeen.set(key, e.ts);
    if (++added % PRUNE_EVERY === 0) {
      for (const [k, t] of lastSeen) if (t < e.ts - cfg.reconnectCollapseMs) lastSeen.delete(k);
    }
    const collapsed = prev !== undefined && e.ts - prev < cfg.reconnectCollapseMs;
    return { value: collapsed ? 0 : 1, distinct: session };
  },
  evaluate(state, cfg) {
    const handshakes = state.sum('R3c', cfg.windowMs);
    if (handshakes < cfg.threshold) return null;
    const sessions = state.distinct('R3c', cfg.windowMs);
    return {
      severity: 'high',
      summary: `${handshakes} new connections in ${describeWindow(cfg.windowMs)} from one source`,
      actions: [{ type: 'block', scope: 'socket', ttlMs: cfg.ttlMs }],
      evidence: { observed: handshakes, threshold: cfg.threshold, windowMs: cfg.windowMs, distinct: sessions },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'src.socketId', 'src.sessionKey', 'src.userHash'],
    };
  },
  /** Tests only: forget remembered sessions. */
  reset: () => lastSeen.clear(),
};

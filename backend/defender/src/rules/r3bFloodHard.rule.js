// R3b — Socket.io event flood, hard step (PRD F4).
// Signal: socket.rate per socket, unweighted. Fires on threshold packets in
// windowMs (100 in 10 s), or when the source's soft firings (R3a throttles and
// R3d bad-payload disconnects) reach softFiringsThreshold in
// softFiringsWindowMs (3 in 5 min) since R3b last fired. Firings are kept per
// source, so reconnecting on a new socket doesn't reset them. Action:
// disconnect the socket and block the `socket` scope for the source, so its
// reconnect is refused with KAIRO_BLOCKED (logged-in sockets bypass IP blocks).
// TTL from the escalation ladder. Severity high (BRIEF D9).

import { describeWindow } from '../utils/describeWindow.js';
import { topEvents } from './r3aFloodSoft.rule.js';

const SOFT_RULES = ['R3a', 'R3d'];

export const r3bFloodHard = {
  id: 'R3b',
  name: 'Socket event flood (hard)',
  family: 'socket',
  version: 1,
  on: ['socket.rate'],
  subject: (e) => e.src.ipHash,
  windowKey: (e) => `socket:${e.src.socketId}`,
  measure: (e) => ({ value: e.sock.total }),
  evaluate(state, cfg, e) {
    const packets = state.sum('R3b', cfg.windowMs);
    const since = state.lastFiring('R3b');
    const softFirings = SOFT_RULES.reduce((n, id) => n + state.firings(id, cfg.softFiringsWindowMs, since), 0);
    if (packets < cfg.threshold && softFirings < cfg.softFiringsThreshold) return null;
    const why = packets >= cfg.threshold ? '' : ` (slowed down ${softFirings}× in ${describeWindow(cfg.softFiringsWindowMs)})`;
    return {
      severity: 'high',
      summary: `${packets} socket events in ${describeWindow(cfg.windowMs)} from one connection${why}`,
      actions: [
        { type: 'disconnect', scope: 'socket', params: { socketId: e.src.socketId } },
        { type: 'block', scope: 'socket' }, // ttl from the escalation ladder
      ],
      evidence: {
        observed: packets,
        threshold: cfg.threshold,
        windowMs: cfg.windowMs,
        softFirings,
        softFiringsThreshold: cfg.softFiringsThreshold,
        histogram: topEvents(e.sock.counts),
      },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'src.socketId', 'sock.counts', 'sock.total'],
    };
  },
};

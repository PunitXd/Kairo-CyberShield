// R3d — malformed payloads (PRD F4).
// Signal: socket.invalid_payload (CypherFy answered BAD_PAYLOAD), per socket.
// Threshold/window from config (10 in 60 s). Action: disconnect the socket;
// the firing counts toward R3b for the source. Evidence names the event, never
// the payload (which Kairo never receives). Severity medium (BRIEF D9).

import { describeWindow } from '../utils/describeWindow.js';

export const r3dBadPayload = {
  id: 'R3d',
  name: 'Malformed payloads',
  family: 'socket',
  version: 1,
  on: ['socket.invalid_payload'],
  subject: (e) => e.src.ipHash,
  windowKey: (e) => `socket:${e.src.socketId}`,
  measure: (e) => ({ value: 1, distinct: e.sock.event }),
  evaluate(state, cfg, e) {
    const bad = state.sum('R3d', cfg.windowMs);
    if (bad < cfg.threshold) return null;
    return {
      severity: 'medium',
      summary: `${bad} malformed payloads in ${describeWindow(cfg.windowMs)} from one connection`,
      actions: [{ type: 'disconnect', scope: 'socket', params: { socketId: e.src.socketId } }],
      evidence: { observed: bad, threshold: cfg.threshold, windowMs: cfg.windowMs, distinct: state.distinct('R3d', cfg.windowMs), event: e.sock.event },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'src.socketId', 'sock.event'],
    };
  },
};

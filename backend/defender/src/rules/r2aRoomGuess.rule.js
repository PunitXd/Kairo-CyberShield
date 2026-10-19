// R2a — ephemeral room-code guessing (PRD F4).
// In CypherFy a room code is also the room's key, so guessing codes is an
// attack on message privacy, not just on availability.
// Signal: room.join.invalid (GET /api/v1/rooms/:code answered 404). Threshold/
// window from config (8 in 60 s) per source. Action: block the `room_join`
// scope; the TTL comes from the escalation ladder (5 / 15 / 60 min).
// Severity medium (BRIEF D9). The PRD's socket disconnect needs the socket
// hooks, which are cut from the Demo MVP.

import { describeWindow } from '../utils/describeWindow.js';

export const r2aRoomGuess = {
  id: 'R2a',
  family: 'room',
  version: 1,
  on: ['room.join.invalid'],
  subject: (e) => e.src.ipHash,
  measure: (e) => ({ value: 1, distinct: e.room.codeHash }),
  evaluate(state, cfg) {
    const misses = state.sum('R2a', cfg.windowMs);
    if (misses < cfg.threshold) return null;
    const codes = state.distinct('R2a', cfg.windowMs);
    return {
      severity: 'medium',
      summary: `${misses} invalid room codes in ${describeWindow(cfg.windowMs)} (${codes} distinct)`,
      actions: [{ type: 'block', scope: 'room_join' }], // ttl from the escalation ladder
      evidence: { observed: misses, threshold: cfg.threshold, windowMs: cfg.windowMs, distinct: codes },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'room.codeHash', 'room.kind', 'room.via'],
    };
  },
};

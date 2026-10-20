// R2a — ephemeral room-code guessing (PRD F4).
// In CypherFy a room code is also the room's key, so guessing codes is an
// attack on message privacy, not just on availability.
// Signal: room.join.invalid, over HTTP (GET /api/v1/rooms/:code answered 404)
// or over a socket (join_room / knock answered ROOM_NOT_FOUND or INVALID_CODE).
// Threshold/window from config (8 in 60 s) per source, both paths together.
// Action: block the `room_join` scope, TTL from the escalation ladder
// (5 / 15 / 60 min); when the crossing miss came over a socket, also
// disconnect that socket (PRD F4). Severity medium (BRIEF D9).

import { describeWindow } from '../utils/describeWindow.js';

export const r2aRoomGuess = {
  id: 'R2a',
  name: 'Room-code guessing',
  family: 'room',
  version: 2,
  on: ['room.join.invalid'],
  subject: (e) => e.src.ipHash,
  measure: (e) => ({ value: 1, distinct: e.room.codeHash }),
  evaluate(state, cfg, e, config) {
    const misses = state.sum('R2a', cfg.windowMs);
    if (misses < cfg.threshold) return null;
    const codes = state.distinct('R2a', cfg.windowMs);
    return {
      severity: 'medium',
      summary: `${misses} invalid room codes in ${describeWindow(cfg.windowMs)} (${codes} distinct)`,
      actions: [
        { type: 'block', scope: 'room_join' }, // ttl from the escalation ladder
        ...(e?.room.via === 'socket' && e.src.socketId ? [{ type: 'disconnect', scope: 'socket', params: { socketId: e.src.socketId } }] : []),
        // Flag the source so a hit on a real room while flagged triggers R2b.
        ...(config?.rules?.R2b ? [{ type: 'flag', scope: 'room_guess', ttlMs: config.rules.R2b.flagWindowMs }] : []),
      ],
      evidence: { observed: misses, threshold: cfg.threshold, windowMs: cfg.windowMs, distinct: codes },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'src.socketId', 'room.codeHash', 'room.kind', 'room.via'],
    };
  },
};

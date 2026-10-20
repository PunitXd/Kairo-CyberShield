// R2b — a flagged source hit a live room (PRD F4, BRIEF D9 Critical).
// Signal: room.hit_while_flagged, which the hooks emit when a source R2a
// flagged within flagWindowMs attempts a join whose code maps to a real room.
// That the attacker guessed (or otherwise obtained) a valid code means the
// code may be known to others, so Kairo locks the room into knock mode for
// knockTtlMs: non-host, non-admitted joiners must knock. The attacker itself is
// already rejected by the hooks (ROOM_NOT_FOUND, indistinguishable from a miss).
//
// family 'room' with subject = the source, so this escalates R2a's own
// incident from "guessing room codes" (medium) to "hit a live room" (critical).
// The knock targets the room via params.codeHash; the raw code never arrives.

export const r2bRoomHit = {
  id: 'R2b',
  name: 'Flagged source hits a live room',
  family: 'room',
  version: 1,
  on: ['room.hit_while_flagged'],
  subject: (e) => e.src.ipHash,
  measure: () => ({ value: 1 }),
  evaluate(_state, cfg, e) {
    return {
      severity: 'critical',
      summary: 'A flagged source hit a live room; locked it with knock mode',
      actions: [{ type: 'knock_mode', scope: 'room', ttlMs: cfg.knockTtlMs, params: { codeHash: e.room.codeHash } }],
      evidence: { observed: 1, roomKind: e.room.kind, codeHash: e.room.codeHash, knockTtlMs: cfg.knockTtlMs },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'room.codeHash', 'room.kind', 'room.via'],
    };
  },
};

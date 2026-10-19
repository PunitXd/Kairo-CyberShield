// What Kairo is doing about an incident right now, for the feed's Action and
// Expires columns. Derived by joining the incident with the active keys from
// /api/blocks (block.added / block.removed keep them live):
//
//   shadow incident               → Shadow (would have acted)
//   active block for it           → Blocked · scope, countdown
//   only an active throttle       → Throttled · scope, countdown
//   kill switch on, key active    → Shadow · kill switch (not enforced)
//   closed by an operator         → Resolved · manually
//   nothing active any more       → Resolved · expired
//
// A block beats a throttle, so the R1 incident changes from Throttled to
// Blocked in place when R1b fires (BRIEF Flow A), keyed by incident id.

export const SCOPE_LABEL = { auth: 'auth', room_join: 'rooms' };

const LEVEL_RANK = { block: 2, throttle: 1 };

export const deriveActionState = (incident, blocks, now, { killSwitch = false } = {}) => {
  if (incident.status === 'shadow') return { state: 'shadow', scope: null, expiresAt: null };

  const active = blocks
    .filter((b) => b.incidentId === incident._id && b.expiresAt > now)
    .sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || b.expiresAt - a.expiresAt);
  const top = active[0];
  if (top) {
    const state = top.level === 'block' ? 'blocked' : 'throttled';
    // Kill switch on: the key still exists (and can still be unblocked) but the
    // hooks don't enforce it, so it reads as Shadow (BRIEF §8).
    if (killSwitch) return { state: 'shadow', reason: 'kill switch', heldBack: state, scope: top.scope, expiresAt: top.expiresAt };
    return { state, scope: top.scope, expiresAt: top.expiresAt };
  }
  if (incident.status === 'manually_resolved') return { state: 'resolved', reason: 'manually', scope: null, expiresAt: null };
  return { state: 'resolved', reason: 'expired', scope: null, expiresAt: null };
};

/** Insert or replace by _id, newest (by ulid) first. */
export const upsertIncident = (list, incident) => {
  const rest = list.filter((i) => i._id !== incident._id);
  return [incident, ...rest].sort((a, b) => (a._id < b._id ? 1 : a._id > b._id ? -1 : 0));
};

/** Key for a block item: one per level + scope + subject. */
export const blockKey = (b) => `${b.level}:${b.scope}:${b.subject}`;

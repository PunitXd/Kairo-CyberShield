// The story of one incident, oldest first, for the drawer (BRIEF §6 S2, Flow
// A step 6): each rule firing ("R1a threshold crossed"), what Kairo did about
// it with its latencies in ms, and how it ended (expired, unblocked by the
// operator, or still running). Built from the incident and its action records
// only; no event data is kept, so there is nothing else it could show.

const ENFORCED = new Set(['applied', 'already_active']);
const VERB = { block: 'Blocked', throttle: 'Throttled', disconnect: 'Disconnected', flag: 'Flagged', knock_mode: 'Knock mode on', rollback: 'Rolled back' };
const SCOPE_LABEL = { auth: 'auth', room_join: 'rooms', socket: 'sockets', room_guess: 'room guessing', room: 'a room', deploy: 'cypherfy-backend' };
const NOT_ACTED = {
  skipped_shadow: 'Would have acted (shadow mode)',
  skipped_killswitch: 'Not acted on: kill switch is on',
  skipped_allowlist: 'Not acted on: source is allowlisted',
  skipped_cap: 'Not acted on: active-block cap reached',
  skipped_budget: 'Not rolled back: the automatic rollback for this window was already used',
  skipped_frozen: 'Not rolled back: automation is frozen',
  failed: 'Action failed',
};

const ms = (d) => (d instanceof Date ? d.getTime() : typeof d === 'string' ? Date.parse(d) : d ?? null);
const minutes = (ttlMs) => (ttlMs >= 60_000 ? `${Math.round(ttlMs / 60_000)} min` : `${Math.round(ttlMs / 1000)} s`);

/**
 * @returns {Array<{ at: number, kind: 'signal'|'action'|'skipped'|'failed'|'resolved'|'pending',
 *                   label: string, detail?: string, ruleId?: string, detectMs?: number, remediateMs?: number }>}
 */
export const buildTimeline = (incident, actions, now = Date.now()) => {
  const sorted = [...actions].sort((a, b) => ms(a.requestedAt) - ms(b.requestedAt));
  const steps = [];
  const signals = new Set();

  for (const a of sorted) {
    const triggerTs = a.triggerEventTs ?? (a.appliedAt && Number.isFinite(a.latencyMs) ? ms(a.appliedAt) - a.latencyMs : ms(a.requestedAt));
    const signalKey = `${a.ruleId}|${triggerTs}`;
    if (!signals.has(signalKey)) {
      signals.add(signalKey);
      steps.push({ at: triggerTs, kind: 'signal', label: `${a.ruleId} threshold crossed`, detail: a.summary ?? undefined, ruleId: a.ruleId });
    }
    const what =
      a.type === 'rollback'
        ? `Rolled back · cypherfy-backend${a.toTag ? ` to ${a.toTag.slice(0, 7)}` : ''}`
        : `${VERB[a.type] ?? a.type} · ${SCOPE_LABEL[a.scope] ?? a.scope}${a.ttlMs ? ` for ${minutes(a.ttlMs)}` : ''}`;
    if (a.result === 'sent') {
      // A command (to the hooks, or a rollback to the deployer) not confirmed yet.
      const waitingOn = a.type === 'rollback' ? 'the deployer has not confirmed it' : 'CypherFy has not confirmed it';
      steps.push({ at: ms(a.requestedAt), kind: 'action', label: what, detail: `Requested; ${waitingOn}`, ruleId: a.ruleId, detectMs: a.ttdMs });
    } else if (ENFORCED.has(a.result)) {
      steps.push({
        at: ms(a.appliedAt),
        kind: 'action',
        label: what,
        detail: a.result === 'already_active' ? 'Already in place; kept the longer expiry' : undefined,
        ruleId: a.ruleId,
        detectMs: a.ttdMs,
        remediateMs: a.latencyMs,
      });
    } else {
      steps.push({
        at: ms(a.requestedAt),
        kind: a.result === 'failed' ? 'failed' : 'skipped',
        label: NOT_ACTED[a.result] ?? a.result,
        ...(a.error ? { detail: a.error } : {}),
        ruleId: a.ruleId,
      });
    }
  }

  // How it ended, decided by the enforced actions.
  const enforced = sorted.filter((a) => ENFORCED.has(a.result) && a.expiresAt);
  if (enforced.length) {
    const lifted = enforced.filter((a) => a.liftedAt).map((a) => ms(a.liftedAt));
    const lastExpiry = Math.max(...enforced.map((a) => ms(a.expiresAt)));
    if (incident.status === 'manually_resolved' && lifted.length) {
      steps.push({ at: Math.max(...lifted), kind: 'resolved', label: 'Unblocked by operator' });
    } else if (lastExpiry <= now) {
      steps.push({ at: lastExpiry, kind: 'resolved', label: 'Expired' });
    } else {
      steps.push({ at: lastExpiry, kind: 'pending', label: 'Expires' });
    }
  }

  // R4: how the deployment ended (the incident carries the deployment's outcome in its summary).
  if (incident.family === 'deploy' && incident.rolledBackAt) steps.push({ at: ms(incident.rolledBackAt), kind: 'resolved', label: 'Previous version healthy again' });

  return steps.sort((a, b) => a.at - b.at);
};

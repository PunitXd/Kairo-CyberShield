// The story of one incident, oldest first, for the drawer (BRIEF §6 S2, Flow
// A step 6): each rule firing ("R1a threshold crossed"), what Kairo did about
// it with its latencies in ms, and how it ended (expired, unblocked by the
// operator, or still running). Built from the incident and its action records
// only; no event data is kept, so there is nothing else it could show.

const ENFORCED = new Set(['applied', 'already_active']);
const VERB = { block: 'Blocked', throttle: 'Throttled' };
const SCOPE_LABEL = { auth: 'auth', room_join: 'rooms' };
const NOT_ACTED = {
  skipped_shadow: 'Would have acted (shadow mode)',
  skipped_killswitch: 'Not acted on: kill switch is on',
  skipped_allowlist: 'Not acted on: source is allowlisted',
  skipped_cap: 'Not acted on: active-block cap reached',
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
    if (ENFORCED.has(a.result)) {
      steps.push({
        at: ms(a.appliedAt),
        kind: 'action',
        label: `${VERB[a.type] ?? a.type} · ${SCOPE_LABEL[a.scope] ?? a.scope} for ${minutes(a.ttlMs ?? 0)}`,
        detail: a.result === 'already_active' ? 'Already in place; kept the longer expiry' : undefined,
        ruleId: a.ruleId,
        detectMs: a.ttdMs,
        remediateMs: a.latencyMs,
      });
    } else {
      steps.push({ at: ms(a.requestedAt), kind: a.result === 'failed' ? 'failed' : 'skipped', label: NOT_ACTED[a.result] ?? a.result, ruleId: a.ruleId });
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

  return steps.sort((a, b) => a.at - b.at);
};

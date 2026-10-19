// R1b — credential stuffing, hard step (PRD F4, ARCH §6.1).
// Signal: the same auth.fail events as R1a. Fires on threshold failures in
// windowMs (10 in 5 min), or when R1a has fired softFiringsThreshold times in
// softFiringsWindowMs (2 in 15 min). Action: block the `auth` scope; the TTL
// comes from the escalation ladder (5 / 15 / 60 min). Severity high (BRIEF D9).

import { describeWindow } from '../utils/describeWindow.js';
import { R1_ROUTES } from './r1aAuthSoft.rule.js';

export const r1bCredentialStuffing = {
  id: 'R1b',
  family: 'auth',
  version: 1,
  on: ['auth.fail'],
  subject: (e) => (R1_ROUTES.has(e.auth.route) ? e.src.ipHash : null),
  measure: (e) => ({ value: 1, distinct: e.auth.accountHash ?? null }),
  evaluate(state, cfg) {
    const fails = state.sum('R1b', cfg.windowMs);
    // Only R1a firings since R1b last fired: once R1b has acted on them, they
    // must not keep re-firing R1b (each re-fire would burn a ladder strike).
    const softFirings = state.firings('R1a', cfg.softFiringsWindowMs, state.lastFiring('R1b'));
    if (fails < cfg.threshold && softFirings < cfg.softFiringsThreshold) return null;
    const accounts = state.distinct('R1b', cfg.windowMs);
    const why = fails >= cfg.threshold ? '' : ` (soft throttle fired ${softFirings}× in ${describeWindow(cfg.softFiringsWindowMs)})`;
    return {
      severity: 'high',
      summary: `${fails} failed logins in ${describeWindow(cfg.windowMs)} across ${accounts} account${accounts === 1 ? '' : 's'}${why}`,
      actions: [{ type: 'block', scope: 'auth' }], // ttl from the escalation ladder
      evidence: {
        observed: fails,
        threshold: cfg.threshold,
        windowMs: cfg.windowMs,
        distinct: accounts,
        softFirings,
        softFiringsThreshold: cfg.softFiringsThreshold,
      },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'auth.route', 'auth.status', 'auth.accountHash'],
    };
  },
};

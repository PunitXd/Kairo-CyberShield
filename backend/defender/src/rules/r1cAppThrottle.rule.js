// R1c — CypherFy's own limiter fired (PRD F4).
// Signal: auth.app_throttled (an auth route answered 429 from CypherFy's own
// authRateLimiter, which backs off per email after a few failures). CypherFy
// already acts on it, so Kairo never does: no actions, always a shadow record,
// so the console shows that one account is being targeted. Severity info
// (BRIEF D9). Its own `app` family keeps it from rewriting an R1 incident's
// summary for the same source. Evidence counts the 429s and distinct accounts
// in windowMs, using firings because each event fires the rule.

import { describeWindow } from '../utils/describeWindow.js';

export const r1cAppThrottle = {
  id: 'R1c',
  family: 'app',
  version: 1,
  on: ['auth.app_throttled'],
  subject: (e) => e.src.ipHash,
  measure: (e) => ({ value: 1, distinct: e.auth.accountHash ?? null }),
  evaluate(state, cfg) {
    const throttled = state.firings('R1c', cfg.windowMs) + 1; // this one is recorded after evaluate
    return {
      severity: 'info',
      summary: `CypherFy's own login limiter answered 429 ${throttled}× in ${describeWindow(cfg.windowMs)}`,
      actions: [], // recorded only: CypherFy already backs off this account
      evidence: { observed: throttled, windowMs: cfg.windowMs },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'auth.route', 'auth.status', 'auth.accountHash'],
    };
  },
};

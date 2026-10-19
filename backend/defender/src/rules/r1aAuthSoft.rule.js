// R1a — brute-force login, soft step (PRD F4).
// Signal: auth.fail from the credential routes. Threshold/window from config
// (5 in 60 s). Action: throttle the `auth` scope for the source (1 request per
// 5 s, enforced by the hook) for ttlMs. Severity medium (BRIEF D9).

import { describeWindow } from '../utils/describeWindow.js';

// The PRD's R1 signal routes. register / verify_email / forgot_password
// failures are user-input errors, not credential guesses.
export const R1_ROUTES = new Set(['login', 'verify_otp', 'reset_password', 'firebase']);

export const r1aAuthSoft = {
  id: 'R1a',
  family: 'auth',
  version: 1,
  on: ['auth.fail'],
  subject: (e) => (R1_ROUTES.has(e.auth.route) ? e.src.ipHash : null),
  measure: (e) => ({ value: 1, distinct: e.auth.accountHash ?? null }),
  evaluate(state, cfg) {
    const fails = state.sum('R1a', cfg.windowMs);
    if (fails < cfg.threshold) return null;
    const accounts = state.distinct('R1a', cfg.windowMs);
    return {
      severity: 'medium',
      summary: `${fails} failed logins in ${describeWindow(cfg.windowMs)} across ${accounts} account${accounts === 1 ? '' : 's'}`,
      actions: [{ type: 'throttle', scope: 'auth', ttlMs: cfg.ttlMs }],
      evidence: { observed: fails, threshold: cfg.threshold, windowMs: cfg.windowMs, distinct: accounts },
      fieldsUsed: ['ts', 'type', 'src.ipHash', 'auth.route', 'auth.status', 'auth.accountHash'],
    };
  },
};

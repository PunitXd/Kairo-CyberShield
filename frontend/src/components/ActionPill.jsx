// What Kairo did, as a pill with an icon and a verb (BRIEF §3 action states).
// A separate colour family from severity: "Blocked" is a good outcome and
// must not read as danger. Full radius only here, so the shape alone says
// "this is an action state". Every icon has a text label next to it.

import { SCOPE_LABEL } from '../utils/incidentState.js';

const ICON_PATHS = {
  // Octagon
  blocked: <path d="M4.5 1h3L11 4.5v3L7.5 11h-3L1 7.5v-3Z" />,
  // Hourglass
  throttled: <path d="M2.5 1h7M2.5 11h7M3 1.5c0 3 6 3 6 4.5S3 7.5 3 10.5M9 1.5c0 3-6 3-6 4.5s6 1.5 6 4.5" />,
  // Check
  resolved: <path d="M2 6.5 4.8 9 10 3" />,
  // Eye
  shadow: (
    <>
      <path d="M1 6s1.8-3.5 5-3.5S11 6 11 6 9.2 9.5 6 9.5 1 6 1 6Z" />
      <circle cx="6" cy="6" r="1.5" />
    </>
  ),
  // Triangle
  failed: <path d="M6 1.5 11 10.5H1Z M6 5v2.5" />,
};

const VERB = { blocked: 'Blocked', throttled: 'Throttled', resolved: 'Resolved', shadow: 'Shadow', failed: 'Failed' };

export default function ActionPill({ state, scope, reason }) {
  const detail = reason === 'kill switch' ? reason : scope ? SCOPE_LABEL[scope] ?? scope : reason;
  return (
    <span className={`pill pill--${state}`}>
      <svg className="pill__icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        {ICON_PATHS[state]}
      </svg>
      <span>
        {VERB[state] ?? state}
        {detail ? ` · ${detail}` : ''}
      </span>
    </span>
  );
}

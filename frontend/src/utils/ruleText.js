// Plain-words text for the Rules & safety screen (PHASES Oct 21 #3).

import { formatWindow } from './liveRates.js';

// What a rule does when it is in Enforce, for the confirm popover.
export const ENFORCE_EFFECT = {
  R1a: 'throttles logins from the source (1 request per 5 s)',
  R1b: 'blocks logins from the source (5, 15, then 60 min)',
  R1c: 'only records an incident',
  R2a: 'blocks room lookups from the source and cuts its socket',
  R2b: 'puts a room hit by a flagged source into knock mode for 10 min',
  R3a: 'slows the flooding socket down',
  R3b: 'disconnects the socket and blocks new sockets from the source',
  R3c: 'blocks new sockets from the source',
  R3d: 'disconnects the socket and blocks new sockets from the source',
};

// The hard rules escalate from their soft step's firings.
const SOFT_RULE = { R1b: 'R1a', R3b: 'R3a' };

const label = (key, ruleId) => {
  const soft = SOFT_RULE[ruleId] ?? 'the soft rule';
  return (
    {
      ttlMs: 'acts for',
      flagWindowMs: 'flag kept',
      knockTtlMs: 'knock mode',
      softFiringsThreshold: `after ${soft} fired`,
      softFiringsWindowMs: `${soft} firings within`,
      reconnectCollapseMs: 'reconnects collapsed within',
      maxPerSec: 'slowed to',
      throttleMs: 'slowed for',
    }[key] ?? key
  );
};
const value = (key, v) => (key.endsWith('Ms') ? formatWindow(v) : key === 'maxPerSec' ? `${v} per s` : `${v}×`);

/** { threshold: 5, windowMs: 60000 } → "5 in 60 s"; no threshold → "—". */
export const thresholdText = (rule) =>
  rule.threshold != null && rule.windowMs != null ? `${rule.threshold} in ${formatWindow(rule.windowMs)}` : rule.windowMs != null ? `window ${formatWindow(rule.windowMs)}` : '—';

/** The other read-only settings, in words: "acts for 5 min · flag kept 10 min". Object values (weights) are left out. */
export const paramsText = (params = {}, ruleId = null) =>
  Object.entries(params)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${label(k, ruleId)} ${value(k, v)}`)
    .join(' · ');

export const MODE_LABEL = { enforce: 'Enforce', shadow: 'Shadow', off: 'Off' };

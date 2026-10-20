// Incidents screen filters (BRIEF §6 S3, PHASES Oct 21 #5), kept in the URL
// query so a filtered view survives a reload and can be shared:
//   ?rule=R1a&severity=high&state=open&range=24h&source=3e9a5b&open=<id>
// Default: last 24 h, every state.

export const RANGES = [
  { value: '1h', label: 'Last hour', ms: 3600_000 },
  { value: '24h', label: 'Last 24 h', ms: 24 * 3600_000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 24 * 3600_000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 24 * 3600_000 },
];
export const DEFAULT_RANGE = '24h';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// What the Defender stores. Expiry is not stored (the Action column derives
// "Resolved · expired" from the blocks), so it is not a filter.
export const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'manually_resolved', label: 'Resolved manually' },
  { value: 'false_positive', label: 'False positive' },
];

const SOURCE_RE = /^(ip:)?[0-9a-f]{4,16}$/;

/** Is this a usable source filter? (a hash, or its first ≥ 4 hex characters) */
export const isSourceQuery = (s) => SOURCE_RE.test(String(s ?? '').trim().toLowerCase());

/** URLSearchParams → filters, dropping anything unknown or malformed. */
export const readFilters = (params) => {
  const get = (k) => params.get(k) ?? '';
  const rule = /^(R\d[a-z]?|fp_storm)$/.test(get('rule')) ? get('rule') : '';
  const severity = SEVERITIES.includes(get('severity')) ? get('severity') : '';
  const state = STATES.some((s) => s.value === get('state')) ? get('state') : '';
  const range = RANGES.some((r) => r.value === get('range')) ? get('range') : DEFAULT_RANGE;
  const source = isSourceQuery(get('source')) ? get('source').trim().toLowerCase().replace(/^ip:/, '') : '';
  return { rule, severity, state, range, source };
};

/** Filters → the GET /api/incidents query (since is computed against `now`). */
export const toApiParams = (f, now) => ({
  ruleId: f.rule || undefined,
  severity: f.severity || undefined,
  status: f.state && f.state !== 'false_positive' ? f.state : undefined,
  falsePositive: f.state === 'false_positive' ? 'true' : undefined,
  since: now - (RANGES.find((r) => r.value === f.range) ?? RANGES[1]).ms,
  source: f.source || undefined,
});

/** True when anything differs from the default view. */
export const isFiltered = (f) => Boolean(f.rule || f.severity || f.state || f.source || f.range !== DEFAULT_RANGE);

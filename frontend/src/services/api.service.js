// Console REST client (ARCH §9.2). Same origin only; the Defender never sends
// CORS headers. Errors arrive as { error: { code, message } } and are thrown
// as ApiRequestError so screens can show the message.

export class ApiRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const request = async (method, path, { params = {}, body } = {}) => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const init = { method, headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Cannot reach the Defender');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? res.statusText);
  }
  return data;
};

export const getHealth = () => request('GET', '/api/health');
export const getOverview = () => request('GET', '/api/overview');
export const getIncidents = (params) => request('GET', '/api/incidents', { params });
export const getBlocks = (params) => request('GET', '/api/blocks', { params });

/** One incident with its actions and timeline → { incident, actions, timeline }. */
export const getIncident = (id) => request('GET', `/api/incidents/${encodeURIComponent(id)}`);

/** Lift every block and throttle on this scope for this source → { undoToken, undoExpiresAt, removed }. */
export const deleteBlock = (scope, subject) =>
  request('DELETE', `/api/blocks/${encodeURIComponent(scope)}/${encodeURIComponent(subject)}`);

/** Restore an unblock → { restored }. The server honours the token for 30 s (the toast shows for 10 s, longer while hovered); 410 UNDO_EXPIRED after that. */
export const undoUnblock = (undoToken) => request('POST', '/api/blocks/undo', { body: { undoToken } });

/** The event contract: fields received and things never received. */
export const getSchema = () => request('GET', '/api/schema');

/** The newest raw events, straight from the stream → { items }. */
export const getEventSample = (limit = 20) => request('GET', '/api/events/sample', { params: { limit } });

/** Turn the global kill switch on or off → { on, since, changed }. */
export const setKillSwitch = (on) => request('POST', '/api/killswitch', { body: { on } });

/** Stored GitHub Actions runs, newest first → { items, sync }. */
export const getPipelineRuns = (limit = 20) => request('GET', '/api/pipeline/runs', { params: { limit } });

/** One run → { run, sync }. */
export const getPipelineRun = (id) => request('GET', `/api/pipeline/runs/${encodeURIComponent(id)}`);

/** The rates.tick history for the live chart → { windowSec, samples } (oldest first). */
export const getRates = (windowSec = 300) => request('GET', '/api/rates', { params: { windowSec } });

/** Rules with config, allowed modes, 7-day counts and the safety numbers → { configVersion, configPath, safety, items }. */
export const getRules = () => request('GET', '/api/rules');

/** Change one rule's mode (thresholds are read-only) → { configVersion, rule, changed }. */
export const setRuleMode = (id, mode) => request('PATCH', `/api/rules/${encodeURIComponent(id)}`, { body: { mode } });

/** Mark an incident a false positive, optionally allowlisting its source → { incident, allowlisted }. */
export const markFalsePositive = (id, { note, allowlistHours } = {}) =>
  request('POST', `/api/incidents/${encodeURIComponent(id)}/false-positive`, { body: { ...(note ? { note } : {}), ...(allowlistHours ? { allowlistHours } : {}) } });

/** Live allowlist entries, soonest expiry first → { items }. */
export const getAllowlist = () => request('GET', '/api/allowlist');

/** Allowlist a typed IP (hashed by the Defender, never stored) or a source hash → { entry }. */
export const addAllowlist = (body) => request('POST', '/api/allowlist', { body });

/** Take a source off the allowlist → { removed }. */
export const removeAllowlist = (subject) => request('DELETE', `/api/allowlist/${encodeURIComponent(subject)}`);

/** Deployments, the version serving now, rollback state and R4 timing → { items, current, rollback, health, config }. */
export const getDeployments = (limit = 20) => request('GET', '/api/deployments', { params: { limit } });

/** Operator: roll this deployment back to its previous healthy version → { requested, toTag }. */
export const rollbackDeployment = (id) => request('POST', `/api/deployments/${encodeURIComponent(id)}/rollback`, { body: {} });

/** Operator: clear the R4 freeze → { changed }. */
export const unfreezeRollback = () => request('POST', '/api/rollback/unfreeze', { body: {} });

/** One incident's attempts over time → { available, ruleId, threshold, windowMs, stepMs, from, to, points: [{ t, n, w }] }. */
export const getIncidentSeries = (id) => request('GET', `/api/incidents/${encodeURIComponent(id)}/series`);

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

/** Lift every block and throttle on this scope for this source → { undoToken, undoExpiresAt, removed }. */
export const deleteBlock = (scope, subject) =>
  request('DELETE', `/api/blocks/${encodeURIComponent(scope)}/${encodeURIComponent(subject)}`);

/** Restore an unblock → { restored }. The server honours the token for 30 s (the toast shows for 10 s, longer while hovered); 410 UNDO_EXPIRED after that. */
export const undoUnblock = (undoToken) => request('POST', '/api/blocks/undo', { body: { undoToken } });

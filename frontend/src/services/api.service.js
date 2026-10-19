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

const getJson = async (path, params = {}) => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Cannot reach the Defender');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(res.status, body?.error?.code ?? `HTTP_${res.status}`, body?.error?.message ?? res.statusText);
  }
  return body;
};

export const getHealth = () => getJson('/api/health');
export const getOverview = () => getJson('/api/overview');
export const getIncidents = (params) => getJson('/api/incidents', params);
export const getBlocks = (params) => getJson('/api/blocks', params);

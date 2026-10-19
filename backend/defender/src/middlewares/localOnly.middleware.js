// Localhost-only console (PHASES §0: no login in the Demo MVP; the port is
// published on 127.0.0.1 only). Two extra checks so a web page open in the
// operator's browser can't read the console either:
//   - Host must be localhost / 127.0.0.1 / [::1] — defeats DNS rebinding,
//     where an attacker's domain is re-pointed at 127.0.0.1.
//   - If an Origin header is present it must be this same origin. Browsers
//     always send Origin on WebSocket handshakes and cross-origin requests.
// Same checks are used for the Socket.io handshake (realtime.service.js).

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const hostnameOf = (hostHeader) => {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const isLocalHost = (hostHeader) => LOCAL_HOSTNAMES.has(hostnameOf(hostHeader ?? ''));

export const isSameOrigin = (origin, hostHeader) => {
  if (!origin) return true; // curl, node scripts, same-origin GETs
  try {
    const o = new URL(origin);
    return (o.protocol === 'http:' || o.protocol === 'https:') && o.host.toLowerCase() === String(hostHeader).toLowerCase();
  } catch {
    return false;
  }
};

/** Shared by Express and the Socket.io handshake. */
export const checkLocalRequest = (headers) => {
  if (!isLocalHost(headers.host)) return 'FORBIDDEN_HOST';
  if (!isSameOrigin(headers.origin, headers.host)) return 'FORBIDDEN_ORIGIN';
  return null;
};

export const localOnly = (req, res, next) => {
  const refusal = checkLocalRequest(req.headers);
  if (!refusal) return next();
  return res.status(403).json({ error: { code: refusal, message: 'The Kairo console is only served to localhost' } });
};

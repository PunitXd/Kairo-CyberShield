// Hooks logging: one JSON line per message key, at most once per interval, so a
// Redis outage under load can't flood CypherFy's logs. Never pass identifiers in.

export const createLogger = ({ intervalMs = 60_000, now = Date.now, sink = console.warn } = {}) => {
  const last = new Map();
  return (msg, fields = {}) => {
    const t = now();
    if (t - (last.get(msg) ?? -Infinity) < intervalMs) return;
    last.set(msg, t);
    sink(JSON.stringify({ time: new Date(t).toISOString(), level: 'warn', svc: 'hooks', msg, ...fields }));
  };
};

/** Unthrottled info line, for one-off lifecycle messages like kairo.enabled. */
export const logInfo = (msg, fields = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level: 'info', svc: 'hooks', msg, ...fields }));

// JSON logs on stdout (ARCH §14.1): time, level, svc, env, msg + fields.
// Never pass raw identifiers in; subjects are already hashes.

import pino from 'pino';

export const createLogger = ({ level = 'info', env } = {}) =>
  pino({
    level,
    base: { svc: 'defender', env },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: ['req.headers.cookie', '*.password', '*.token', 'ip', '*.ip'], remove: true },
  });

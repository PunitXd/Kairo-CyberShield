// Central error handling for the console API (ARCH §9):
// { "error": { "code": "NOT_FOUND", "message": "…" } }. Clients never see stack
// traces or internals; unexpected errors are logged server-side.

import { ZodError } from 'zod';

import { ApiError } from '../utils/ApiError.js';

export const notFoundHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    // Field paths only, never the rejected values.
    const fields = err.issues.map((i) => i.path.join('.') || '(root)').slice(0, 5);
    return res.status(400).json({ error: { code: 'INVALID_QUERY', message: `Invalid parameter: ${fields.join(', ')}` } });
  }
  // express.json() errors: a client mistake, not a server fault (messages are
  // ours, never the parser's, which can echo the body).
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'MALFORMED_BODY', message: 'Request body is not valid JSON' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  req.app.locals.kairo?.log?.error({ msg: 'api.error', method: req.method, path: req.path, error: err?.message?.slice(0, 200) });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error' } });
};

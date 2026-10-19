// Console API Express app (ARCH §9). The HTTP server and Socket.io are wired
// up in index.js.
//
// Dependencies (redis, mongo, env, getConsumerStats, log) are passed in and
// kept on app.locals.kairo, so controllers stay plain (req, res) handlers and
// tests can inject fakes. No login in the Demo MVP: localOnly restricts the
// API to localhost (see middlewares/localOnly.middleware.js). No CORS headers
// are ever sent: the dashboard is served from this same origin.

import express from 'express';

import healthRoutes from './routes/health.route.js';
import overviewRoutes from './routes/overview.route.js';
import incidentRoutes from './routes/incident.route.js';
import blockRoutes from './routes/block.route.js';
import { localOnly } from './middlewares/localOnly.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';

export const createApp = (deps) => {
  const app = express();
  app.disable('x-powered-by');
  app.locals.kairo = deps;

  app.use(localOnly);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // --- Routes ---
  app.use('/api/health', healthRoutes);
  app.use('/api/overview', overviewRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/blocks', blockRoutes);

  // --- Unmatched routes → 404, then the error handler (must be last) ---
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

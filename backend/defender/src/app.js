// Console API Express app (ARCH §9). The HTTP server and Socket.io are wired
// up in index.js.
//
// Dependencies (redis, mongo, env, getConsumerStats, getRules, log, and an
// optional publicDir) are passed in and kept on app.locals.kairo, so
// controllers stay plain (req, res) handlers and tests can inject fakes. No
// login in the Demo MVP: localOnly restricts the API and the dashboard to
// localhost (see middlewares/localOnly.middleware.js). No CORS headers are
// ever sent: the dashboard is served from this same origin.

import express from 'express';

import healthRoutes from './routes/health.route.js';
import overviewRoutes from './routes/overview.route.js';
import incidentRoutes from './routes/incident.route.js';
import blockRoutes from './routes/block.route.js';
import eventRoutes from './routes/event.route.js';
import schemaRoutes from './routes/schema.route.js';
import { localOnly } from './middlewares/localOnly.middleware.js';
import { createDashboardRouter } from './middlewares/dashboard.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';

export const createApp = (deps) => {
  const app = express();
  app.disable('x-powered-by');
  app.locals.kairo = deps;

  app.use(localOnly);
  // JSON bodies only, and tiny: a cross-site form can't send JSON without a
  // CORS preflight, which this server never answers.
  app.use('/api', express.json({ limit: '1kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // --- API routes ---
  app.use('/api/health', healthRoutes);
  app.use('/api/overview', overviewRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/blocks', blockRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/schema', schemaRoutes);
  app.use('/api', notFoundHandler); // unknown API paths get JSON, never the page

  // --- Dashboard (built into backend/defender/public by the Dockerfile) ---
  const dashboard = createDashboardRouter(deps.publicDir);
  if (dashboard) app.use(dashboard);
  else deps.log?.warn({ msg: 'dashboard.not_built', hint: 'API only; build frontend/ into backend/defender/public' });

  // --- Unmatched routes → 404, then the error handler (must be last) ---
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

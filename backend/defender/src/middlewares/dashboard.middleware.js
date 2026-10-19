// Serves the built dashboard (frontend/ → backend/defender/public, Oct 20
// task 5) from the same origin as the API, so the page needs no CORS and
// the realtime socket is same-origin.
//
//   /assets/*    hashed Vite output: cached for a year, immutable;
//                a missing asset is a real 404, never the page
//   /, /blocks…  any extensionless GET outside /api → index.html (SPA routes),
//                no-cache so a rebuilt dashboard shows up on the next load
//
// Every page response carries a strict CSP: only this origin may serve
// scripts, styles, fonts and connections (same-origin WebSocket included),
// and the page can't be framed.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { Router } from 'express';

import { notFoundHandler } from './error.middleware.js';

export const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const pageHeaders = (_req, res, next) => {
  res.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
};

// Extensionless paths that aren't the API: the dashboard's client-side routes.
const SPA_ROUTE = /^\/(?!api(?:\/|$))[^.]*$/;

/** Router serving the dashboard, or null when it hasn't been built. */
export const createDashboardRouter = (publicDir = DEFAULT_PUBLIC_DIR) => {
  const indexFile = path.join(publicDir, 'index.html');
  if (!existsSync(indexFile)) return null;

  const router = Router();
  router.use(pageHeaders);
  router.use('/assets', express.static(path.join(publicDir, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  router.use('/assets', notFoundHandler);
  router.use(express.static(publicDir, { index: false }));
  router.get(SPA_ROUTE, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
  return router;
};

// GET /api/health — liveness for Compose and the console banner (ARCH §9.2).

import { asyncHandler } from '../utils/asyncHandler.js';
import { getSystemStatus } from '../services/health.service.js';

export const getHealth = asyncHandler(async (req, res) => {
  res.json(await getSystemStatus(req.app.locals.kairo));
});

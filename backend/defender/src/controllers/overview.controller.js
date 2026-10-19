// GET /api/overview — the KPI strip (ARCH §9.2).

import { asyncHandler } from '../utils/asyncHandler.js';
import { computeOverview } from '../services/metrics.service.js';

export const getOverview = asyncHandler(async (req, res) => {
  res.json(await computeOverview(req.app.locals.kairo));
});

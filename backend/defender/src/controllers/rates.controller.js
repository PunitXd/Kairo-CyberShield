// GET /api/rates?windowSec=300 → { samples } — the rates.tick history, so a
// freshly opened dashboard starts with a full chart (PHASES Oct 20 #7).

import { asyncHandler } from '../utils/asyncHandler.js';
import { ratesQuerySchema } from '../validators/ratesQuery.schema.js';

export const getRates = asyncHandler(async (req, res) => {
  const { windowSec } = ratesQuerySchema.parse(req.query);
  res.json({ windowSec, samples: req.app.locals.kairo.getRates?.(windowSec) ?? [] });
});

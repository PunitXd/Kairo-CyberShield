// GET /api/blocks — active blocks and throttles (ARCH §9.2).

import { asyncHandler } from '../utils/asyncHandler.js';
import { blockQuerySchema } from '../validators/blockQuery.schema.js';
import { listBlocks } from '../services/block.service.js';

export const getBlocks = asyncHandler(async (req, res) => {
  const { scope } = blockQuerySchema.parse(req.query);
  res.json({ items: await listBlocks(req.app.locals.kairo.redis, { scope }) });
});

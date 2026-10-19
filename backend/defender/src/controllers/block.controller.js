// /api/blocks — list active blocks, unblock one, undo an unblock (ARCH §9.2, §4.3).

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { blockQuerySchema } from '../validators/blockQuery.schema.js';
import { undoBodySchema, unblockParamsSchema } from '../validators/unblock.schema.js';
import { listBlocks } from '../services/block.service.js';
import { isRedisReady, REDIS_UNAVAILABLE, withRedis } from '../utils/withRedis.js';

export const getBlocks = asyncHandler(async (req, res) => {
  const { scope } = blockQuerySchema.parse(req.query);
  const { redis } = req.app.locals.kairo;
  res.json({ items: await withRedis(redis, () => listBlocks(redis, { scope })) });
});

// DELETE /api/blocks/:scope/:subject → 200 { undoToken, undoExpiresAt, removed }
export const deleteBlock = asyncHandler(async (req, res) => {
  const { scope, subject } = unblockParamsSchema.parse(req.params);
  // Writes are refused up front, never queued: a queued unblock would run whenever Redis came back.
  if (!isRedisReady(req.app.locals.kairo.redis)) throw REDIS_UNAVAILABLE();
  const result = await req.app.locals.kairo.unblock.unblock(scope, subject, { actorIp: req.ip });
  if (!result) throw new ApiError(404, 'NOT_FOUND', 'Nothing is blocked or throttled for this source and scope');
  res.json(result);
});

// POST /api/blocks/undo { undoToken } → 200 { restored } | 410 UNDO_EXPIRED
export const undoUnblock = asyncHandler(async (req, res) => {
  const { undoToken } = undoBodySchema.parse(req.body ?? {});
  if (!isRedisReady(req.app.locals.kairo.redis)) throw REDIS_UNAVAILABLE();
  const result = await req.app.locals.kairo.unblock.undo(undoToken, { actorIp: req.ip });
  if (!result) throw new ApiError(410, 'UNDO_EXPIRED', 'The undo window has passed');
  res.json(result);
});

// /api/pipeline — GitHub Actions runs stored by the poller (ARCH §4.4).
// Every response carries the poller's sync state, so the screen can say
// "Can't reach GitHub · last synced 14:02" while still showing stored runs.

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { pipelineQuerySchema } from '../validators/pipelineQuery.schema.js';
import { pipelineParamsSchema } from '../validators/pipelineParams.schema.js';

const OFF = { ok: null, error: 'poller_off', repo: null, tokenConfigured: false };
const syncOf = (req) => req.app.locals.kairo.getPipelineSync?.() ?? OFF;

// GET /api/pipeline/runs → { items, sync }, newest first
export const listRuns = asyncHandler(async (req, res) => {
  const q = pipelineQuerySchema.parse(req.query);
  const items = await req.app.locals.kairo.mongo.pipelineRuns.find({}).sort({ startedAt: -1 }).limit(q.limit).toArray();
  res.json({ items, sync: syncOf(req) });
});

// GET /api/pipeline/runs/:id → { run, sync }
export const getRun = asyncHandler(async (req, res) => {
  const { id } = pipelineParamsSchema.parse(req.params);
  const run = await req.app.locals.kairo.mongo.pipelineRuns.findOne({ _id: id });
  if (!run) throw new ApiError(404, 'NOT_FOUND', 'Pipeline run not found');
  res.json({ run, sync: syncOf(req) });
});

// KPI numbers for GET /api/overview (ARCH §9.2, §14.2), measured from the
// Defender's own records so a judge sees numbers, not a claim (PRD §9):
//   TTD = trigger event ts → incident detected   (action.ttdMs)
//   TTR = trigger event ts → action applied      (action.latencyMs)

import { listBlocks } from './block.service.js';
import { summarizeRun } from './pipeline.service.js';
import { percentile } from '../utils/percentile.js';
import { withRedis } from '../utils/withRedis.js';

const DAY_MS = 24 * 3600_000;

export const computeOverview = async ({ redis, mongo, getConfig, now = Date.now() }) => {
  const since = new Date(now - DAY_MS);
  const [actions, incidents24h, blocks, lastRun] = await Promise.all([
    mongo.actions
      .find({ appliedAt: { $gte: since }, result: { $in: ['applied', 'already_active'] } }, { projection: { ttdMs: 1, latencyMs: 1 } })
      .toArray(),
    mongo.incidents.countDocuments({ detectedAt: { $gte: since } }),
    // Redis down: the Mongo-backed numbers still come back; active blocks are unknown (null).
    withRedis(redis, () => listBlocks(redis, { now }), { timeoutMs: 1000 }).catch(() => null),
    mongo.pipelineRuns ? mongo.pipelineRuns.find({}).sort({ startedAt: -1 }).limit(1).toArray() : [],
  ]);

  return {
    activeBlocks: blocks ? blocks.filter((b) => b.level === 'block').length : null, // throttles are listed, not counted as blocks
    ttdP95Ms: percentile(actions.map((a) => a.ttdMs), 95),
    ttrP95Ms: percentile(actions.map((a) => a.latencyMs), 95),
    incidents24h,
    activeBlockCap: getConfig?.().global.activeBlockCap ?? null, // safeguard 5 (ARCH §7.2)
    lastPipeline: summarizeRun(lastRun[0]) ?? null, // newest stored GitHub Actions run
  };
};

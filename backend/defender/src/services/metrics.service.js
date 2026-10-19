// KPI numbers for GET /api/overview (ARCH §9.2, §14.2), measured from the
// Defender's own records so a judge sees numbers, not a claim (PRD §9):
//   TTD = trigger event ts → incident detected   (action.ttdMs)
//   TTR = trigger event ts → action applied      (action.latencyMs)

import { listBlocks } from './block.service.js';
import { percentile } from '../utils/percentile.js';

const DAY_MS = 24 * 3600_000;

export const computeOverview = async ({ redis, mongo, now = Date.now() }) => {
  const since = new Date(now - DAY_MS);
  const [actions, incidents24h, blocks] = await Promise.all([
    mongo.actions
      .find({ appliedAt: { $gte: since }, result: { $in: ['applied', 'already_active'] } }, { projection: { ttdMs: 1, latencyMs: 1 } })
      .toArray(),
    mongo.incidents.countDocuments({ detectedAt: { $gte: since } }),
    listBlocks(redis, { now }),
  ]);

  return {
    activeBlocks: blocks.filter((b) => b.level === 'block').length, // throttles are listed, not counted as blocks
    ttdP95Ms: percentile(actions.map((a) => a.ttdMs), 95),
    ttrP95Ms: percentile(actions.map((a) => a.latencyMs), 95),
    incidents24h,
    lastPipeline: null, // filled by the GitHub poller (Oct 22)
  };
};

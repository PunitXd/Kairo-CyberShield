// GET /api/incidents — newest first, cursor-paginated by ulid (ARCH §9.2).
// Query values are validated by the strict schema before they reach Mongo, so
// nothing from the request is ever used as a query operator.

import { asyncHandler } from '../utils/asyncHandler.js';
import { incidentQuerySchema } from '../validators/incidentQuery.schema.js';

export const listIncidents = asyncHandler(async (req, res) => {
  const q = incidentQuerySchema.parse(req.query);
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.ruleId) filter.ruleId = q.ruleId;
  if (q.severity) filter.severity = q.severity;
  if (q.since) filter.detectedAt = { $gte: new Date(q.since) };
  if (q.cursor) filter._id = { $lt: q.cursor };

  const page = await req.app.locals.kairo.mongo.incidents
    .find(filter)
    .sort({ _id: -1 })
    .limit(q.limit + 1)
    .toArray();
  const items = page.slice(0, q.limit);
  res.json({ items, nextCursor: page.length > q.limit ? items.at(-1)._id : null });
});

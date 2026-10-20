// /api/incidents — list (newest first, cursor-paginated by ulid) and detail
// with its timeline (ARCH §9.2). Query values are validated by strict schemas
// before they reach Mongo, so nothing from the request is ever used as a
// query operator.

import { ulid } from 'ulid';

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { buildTimeline } from '../utils/buildTimeline.js';
import { incidentQuerySchema } from '../validators/incidentQuery.schema.js';
import { incidentParamsSchema } from '../validators/incidentParams.schema.js';
import { falsePositiveBodySchema } from '../validators/allowlist.schema.js';
import { isRedisReady, REDIS_UNAVAILABLE, withRedis } from '../utils/withRedis.js';

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

// GET /api/incidents/:id → { incident, actions, timeline }
export const getIncident = asyncHandler(async (req, res) => {
  const { id } = incidentParamsSchema.parse(req.params);
  const { mongo } = req.app.locals.kairo;
  const incident = await mongo.incidents.findOne({ _id: id });
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
  const actions = await mongo.actions.find({ incidentId: id }).sort({ requestedAt: 1 }).toArray();
  res.json({ incident, actions, timeline: buildTimeline(incident, actions) });
});

const HEX16 = /^[0-9a-f]{16}$/;

// POST /api/incidents/:id/false-positive { note?, allowlistHours? } → 200 { incident, allowlisted }
// Records the incident as a false positive (counted per rule on the Rules
// screen) and, optionally, allowlists its source for up to 24 h (BRIEF Flow B).
// Marking is a record only; Unblock stays a separate action.
export const markFalsePositive = asyncHandler(async (req, res) => {
  const { id } = incidentParamsSchema.parse(req.params);
  const { note, allowlistHours } = falsePositiveBodySchema.parse(req.body ?? {});
  const { mongo, redis, allowlist, hasher, bus, log } = req.app.locals.kairo;
  const incident = await mongo.incidents.findOne({ _id: id });
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
  if (allowlistHours) {
    if (!HEX16.test(String(incident.subject))) throw new ApiError(400, 'NOT_ALLOWLISTABLE', 'This incident has no source to allowlist');
    if (!isRedisReady(redis)) throw REDIS_UNAVAILABLE(); // check before changing anything
  }

  const at = new Date();
  if (!incident.falsePositive) {
    await mongo.incidents.updateOne({ _id: id }, { $set: { falsePositive: true, falsePositiveAt: at, ...(note ? { falsePositiveNote: note } : {}) } });
    await mongo.auditLog.insertOne({
      _id: ulid(),
      at,
      actor: 'operator',
      actorIpHash: hasher ? hasher.ip(req.ip) : null,
      op: 'mark_fp',
      target: { incidentId: id, ruleId: incident.ruleId, subject: incident.subject },
      before: { falsePositive: false },
      after: { falsePositive: true },
    });
    log?.warn({ msg: 'operator.mark_fp', incidentId: id, rule: incident.ruleId });
  }
  let allowlisted = null;
  if (allowlistHours) {
    allowlisted = await withRedis(redis, () =>
      allowlist.add({ subject: incident.subject, hours: allowlistHours, reason: note ?? null, source: 'false_positive', incidentId: id, actorIp: req.ip })
    );
  }
  const updated = await mongo.incidents.findOne({ _id: id });
  bus?.emit('incident.updated', updated);
  res.json({ incident: updated, allowlisted });
});

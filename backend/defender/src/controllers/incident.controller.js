// /api/incidents — list (newest first, cursor-paginated by ulid; filters by
// state, rule fired, severity, time, source hash prefix, false positive) and detail
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
import { SERIES_RETENTION_MS, SERIES_RULE_BY_FAMILY } from '../services/rates.service.js';

export const listIncidents = asyncHandler(async (req, res) => {
  const q = incidentQuerySchema.parse(req.query);
  const filter = {};
  if (q.status) filter.status = q.status;
  // Any rule that fired in the incident: R1a also finds incidents that escalated to R1b.
  if (q.ruleId) filter.$or = [{ ruleId: q.ruleId }, { rulesFired: q.ruleId }];
  // Validated hex only (see incidentQuery.schema), so the prefix is a literal, never a pattern.
  if (q.source) filter.subject = { $regex: `^${q.source}` };
  if (q.falsePositive) filter.falsePositive = true;
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

const SERIES_MAX_POINTS = 120;

// GET /api/incidents/:id/series → the source's attempts around this incident,
// for the drawer's chart (PHASES Oct 22 #5): the rolling window count of the
// family's charted rule (what it compares with its threshold), from just
// before the first event to one window after the last activity (so the line
// is seen falling back as the window empties), at most SERIES_MAX_POINTS
// steps. `until` is where the axis ends: at least one full window, even while
// the attack is still running. Kept for SERIES_RETENTION_MS; older is "expired".
export const getIncidentSeries = asyncHandler(async (req, res) => {
  const { id } = incidentParamsSchema.parse(req.params);
  const { mongo, getSeries, getConfig } = req.app.locals.kairo;
  const incident = await mongo.incidents.findOne({ _id: id });
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
  const ruleId = SERIES_RULE_BY_FAMILY[incident.family];
  const cfg = ruleId ? getConfig?.().rules[ruleId] : null;
  if (!ruleId || !cfg || !getSeries) {
    res.json({ available: false, reason: 'no_series', ruleId: ruleId ?? null });
    return;
  }
  const now = Date.now();
  const toMs = (d) => (d instanceof Date ? d.getTime() : typeof d === 'string' ? Date.parse(d) : Number(d) || null);
  const first = toMs(incident.firstEventTs) ?? toMs(incident.detectedAt) ?? now;
  const last = Math.max(toMs(incident.lastSeenAt) ?? first, first);
  const LEAD_MS = 5000;
  // Start just before the first event, or before the oldest data still kept
  // (a Defender restart or the retention window may have dropped the start).
  const oldest = getSeries(ruleId, incident.subject, { from: now, to: now - 1, stepMs: 1000, windowMs: cfg.windowMs }).oldestMs;
  const from = Math.max(first - LEAD_MS, (oldest ?? 0) - LEAD_MS, now - SERIES_RETENTION_MS);
  const to = Math.min(now, last + cfg.windowMs);
  const until = Math.max(to, Math.min(from + cfg.windowMs + 2 * LEAD_MS, last + cfg.windowMs));
  if (to <= from) {
    res.json({ available: false, reason: 'expired', ruleId, threshold: cfg.threshold, windowMs: cfg.windowMs, retentionMs: SERIES_RETENTION_MS });
    return;
  }
  const stepMs = Math.max(1000, Math.ceil((until - from) / SERIES_MAX_POINTS / 1000) * 1000);
  const s = getSeries(ruleId, incident.subject, { from, to, stepMs, windowMs: cfg.windowMs });
  res.json({
    available: s.available,
    reason: s.available ? null : 'expired',
    ruleId,
    threshold: cfg.threshold,
    windowMs: cfg.windowMs,
    stepMs,
    from,
    to,
    until,
    points: s.points,
    retentionMs: SERIES_RETENTION_MS,
  });
});

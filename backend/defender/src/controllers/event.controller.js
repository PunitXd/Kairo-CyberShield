// /api/events/sample and /api/schema — the Privacy screen's evidence that Kairo
// receives metadata only (ARCH §9.2, BRIEF §6 S8).

import { fromStreamFields } from 'kairo-schema';

import { asyncHandler } from '../utils/asyncHandler.js';
import { KEYS } from '../defender.constant.js';
import { eventSampleQuerySchema } from '../validators/eventSample.schema.js';
import { getEventContract } from '../services/schema.service.js';

// GET /api/events/sample?limit=20 → { items } newest first, straight from the
// stream. Re-validated against the strict schema; anything else is dropped.
export const getEventSample = asyncHandler(async (req, res) => {
  const { limit } = eventSampleQuerySchema.parse(req.query);
  const entries = await req.app.locals.kairo.redis.xrevrange(KEYS.events, '+', '-', 'COUNT', limit);
  const items = [];
  for (const [, fields] of entries) {
    const parsed = fromStreamFields(fields ?? []);
    if (parsed.success) items.push(parsed.data);
  }
  res.json({ items });
});

// GET /api/schema → the event contract: fields received, things never received.
export const getSchema = (_req, res) => {
  res.json(getEventContract());
};

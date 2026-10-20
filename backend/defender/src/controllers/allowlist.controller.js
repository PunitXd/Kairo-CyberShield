// /api/allowlist (ARCH §9.2). A typed IP is hashed here with the same HMAC
// the hooks use and then dropped: it is never stored, logged or echoed back.

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { withRedis } from '../utils/withRedis.js';
import { allowlistBodySchema, allowlistParamsSchema } from '../validators/allowlist.schema.js';

// GET /api/allowlist → { items }
export const listAllowlist = asyncHandler(async (req, res) => {
  const { redis, allowlist } = req.app.locals.kairo;
  res.json({ items: await withRedis(redis, () => allowlist.list()) });
});

// POST /api/allowlist { ip | subject, reason?, hours } → 201 { entry }
export const addAllowlist = asyncHandler(async (req, res) => {
  const body = allowlistBodySchema.parse(req.body ?? {});
  const { redis, allowlist, hasher } = req.app.locals.kairo;
  let subject = body.subject;
  if (body.ip) {
    if (!hasher) throw new ApiError(503, 'NO_HASHER', 'KAIRO_HASH_SECRET is not set, so an IP cannot be hashed');
    subject = hasher.ip(body.ip);
  }
  const entry = await withRedis(redis, () => allowlist.add({ subject, hours: body.hours, reason: body.reason ?? null, actorIp: req.ip }));
  res.status(201).json({ entry });
});

// DELETE /api/allowlist/:subject → 200 { removed }
export const removeAllowlist = asyncHandler(async (req, res) => {
  const { subject } = allowlistParamsSchema.parse(req.params);
  const { redis, allowlist } = req.app.locals.kairo;
  const out = await withRedis(redis, () => allowlist.remove(subject, { actorIp: req.ip }));
  if (!out.removed) throw new ApiError(404, 'NOT_FOUND', 'That source is not on the allowlist');
  res.json(out);
});

// POST /api/killswitch { on } → 200 { on, since, changed } (ARCH §9.2).

import { asyncHandler } from '../utils/asyncHandler.js';
import { killSwitchBodySchema } from '../validators/killswitch.schema.js';
import { isRedisReady, REDIS_UNAVAILABLE } from '../utils/withRedis.js';

export const setKillSwitch = asyncHandler(async (req, res) => {
  const { on } = killSwitchBodySchema.parse(req.body ?? {});
  if (!isRedisReady(req.app.locals.kairo.redis)) throw REDIS_UNAVAILABLE(); // the switch is a Redis key
  res.json(await req.app.locals.kairo.killSwitch.set(on, { actorIp: req.ip }));
});

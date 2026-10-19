// POST /api/killswitch { on } → 200 { on, since, changed } (ARCH §9.2).

import { asyncHandler } from '../utils/asyncHandler.js';
import { killSwitchBodySchema } from '../validators/killswitch.schema.js';

export const setKillSwitch = asyncHandler(async (req, res) => {
  const { on } = killSwitchBodySchema.parse(req.body ?? {});
  res.json(await req.app.locals.kairo.killSwitch.set(on, { actorIp: req.ip }));
});

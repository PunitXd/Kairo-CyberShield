// DELETE /api/knock/:codeHash — lift knock mode on a room early (R2b).

import { asyncHandler } from '../utils/asyncHandler.js';
import { knockParamsSchema } from '../validators/knockParams.schema.js';

export const deleteKnock = asyncHandler(async (req, res) => {
  const { codeHash } = knockParamsSchema.parse(req.params);
  res.json(await req.app.locals.kairo.knock.lift(codeHash, { actorIp: req.ip }));
});

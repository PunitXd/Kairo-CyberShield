// Inputs for DELETE /api/blocks/:scope/:subject and POST /api/blocks/undo
// (ARCH §9.2). The subject must be a 16-hex hash, so a raw IP or anything
// else can never reach a Redis key name.

import { z } from 'zod';
import { SCOPES } from 'kairo-schema';

export const unblockParamsSchema = z.strictObject({
  scope: z.enum(SCOPES),
  subject: z.string().regex(/^[0-9a-f]{16}$/),
});

export const undoBodySchema = z.strictObject({
  undoToken: z.string().regex(/^[0-9a-f]{32}$/),
});

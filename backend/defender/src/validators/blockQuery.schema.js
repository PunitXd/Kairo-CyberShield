// Query for GET /api/blocks (ARCH §9.2).

import { z } from 'zod';
import { SCOPES } from 'kairo-schema';

export const blockQuerySchema = z.strictObject({
  scope: z.enum(SCOPES).optional(),
});

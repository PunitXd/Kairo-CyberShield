// Path param for DELETE /api/knock/:codeHash — a room code hash (16 hex).

import { z } from 'zod';

export const knockParamsSchema = z.strictObject({
  codeHash: z.string().regex(/^[0-9a-f]{16}$/),
});

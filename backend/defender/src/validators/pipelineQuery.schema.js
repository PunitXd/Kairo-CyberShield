// Query for GET /api/pipeline/runs. Strict: unknown parameters are rejected.

import { z } from 'zod';

export const pipelineQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

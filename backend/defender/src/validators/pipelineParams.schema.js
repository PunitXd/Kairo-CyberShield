// Path params for GET /api/pipeline/runs/:id: a GitHub run id (digits only).

import { z } from 'zod';

export const pipelineParamsSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[1-9]\d{0,15}$/)
    .transform(Number),
});

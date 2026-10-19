// Query for GET /api/events/sample (ARCH §9.2).

import { z } from 'zod';

export const eventSampleQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

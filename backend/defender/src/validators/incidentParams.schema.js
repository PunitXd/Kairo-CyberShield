// Route params for GET /api/incidents/:id — incident ids are ulids.

import { z } from 'zod';

export const incidentParamsSchema = z.strictObject({
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
});

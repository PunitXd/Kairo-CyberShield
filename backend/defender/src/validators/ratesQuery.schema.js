// Query for GET /api/rates. Strict: unknown parameters are rejected.

import { z } from 'zod';

import { HISTORY_SEC } from '../services/rates.service.js';

export const ratesQuerySchema = z.strictObject({
  windowSec: z.coerce.number().int().min(1).max(HISTORY_SEC).default(HISTORY_SEC),
});

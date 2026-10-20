// Query for GET /api/incidents (ARCH §9.2). Strict: unknown or repeated
// parameters are rejected, not ignored.

import { z } from 'zod';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const incidentQuerySchema = z.strictObject({
  status: z.enum(['open', 'auto_resolved', 'manually_resolved', 'shadow']).optional(),
  ruleId: z
    .string()
    .regex(/^(R[0-9][a-z]?|fp_storm)$/)
    .optional(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
  since: z.coerce.number().int().positive().optional(), // ms epoch
  // A source hash or its first ≥ 4 hex characters, with or without "ip:".
  source: z
    .string()
    .regex(/^(ip:)?[0-9a-f]{4,16}$/)
    .transform((s) => s.replace(/^ip:/, ''))
    .optional(),
  falsePositive: z.literal('true').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(ULID).optional(), // ulid of the last item of the previous page
});

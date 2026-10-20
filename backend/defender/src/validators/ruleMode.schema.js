// PATCH /api/rules/:id (ARCH §9.2): mode only; thresholds are read-only (BRIEF D4).

import { z } from 'zod';

export const ruleParamsSchema = z.strictObject({ id: z.string().regex(/^R\d[a-z]?$/, 'expected a rule id like R1b') });
export const ruleModeBodySchema = z.strictObject({ mode: z.enum(['enforce', 'shadow', 'off']) });

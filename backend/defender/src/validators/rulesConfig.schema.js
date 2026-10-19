// Schema for defender/config/rules.json (ARCH §6.2). Strict: a typo in a key
// fails the load instead of being silently ignored, and only Demo MVP rules
// are configurable.

import { z } from 'zod';

const HOUR_MS = 3_600_000;

const zPosInt = z.number().int().positive();
const zMode = z.enum(['enforce', 'shadow', 'off']);

export const rulesConfigSchema = z.strictObject({
  version: zPosInt,
  global: z.strictObject({
    maxBlockMs: zPosInt.max(HOUR_MS), // no automatic block exceeds 60 min (PRD F3)
    ladderMs: z.array(zPosInt).min(1),
    strikesTtlMs: zPosInt,
    activeBlockCap: zPosInt,
    staleEventMs: zPosInt,
  }),
  rules: z.strictObject({
    R1a: z.strictObject({ mode: zMode, threshold: zPosInt, windowMs: zPosInt, ttlMs: zPosInt }),
    R1b: z.strictObject({
      mode: zMode,
      threshold: zPosInt,
      windowMs: zPosInt,
      softFiringsThreshold: zPosInt,
      softFiringsWindowMs: zPosInt,
    }),
    R2a: z.strictObject({ mode: zMode, threshold: zPosInt, windowMs: zPosInt }),
  }),
});

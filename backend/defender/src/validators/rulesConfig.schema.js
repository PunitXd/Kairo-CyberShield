// Schema for defender/config/rules.json (ARCH §6.2). Strict: a typo in a key
// fails the load instead of being silently ignored, and only built rules are
// configurable.

import { z } from 'zod';

const HOUR_MS = 3_600_000;

const zPosInt = z.number().int().positive();
const zMode = z.enum(['enforce', 'shadow', 'off']);
const zEventName = z.string().regex(/^[A-Za-z][A-Za-z0-9_:.-]{0,31}$/);

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
    // R1c only records: there is nothing for it to enforce.
    R1c: z.strictObject({ mode: z.enum(['shadow', 'off']), windowMs: zPosInt }),
    R2a: z.strictObject({ mode: zMode, threshold: zPosInt, windowMs: zPosInt }),
    R2b: z.strictObject({ mode: zMode, flagWindowMs: zPosInt, knockTtlMs: zPosInt.max(HOUR_MS) }),
    R3a: z.strictObject({
      mode: zMode,
      threshold: zPosInt,
      windowMs: zPosInt,
      signalWeight: z.record(zEventName, z.number().min(0).max(1)), // WebRTC signalling counts less
      maxPerSec: zPosInt.max(100),
      throttleMs: zPosInt.max(600_000),
    }),
    R3b: z.strictObject({
      mode: zMode,
      threshold: zPosInt,
      windowMs: zPosInt,
      softFiringsThreshold: zPosInt,
      softFiringsWindowMs: zPosInt,
    }),
    R3c: z.strictObject({ mode: zMode, threshold: zPosInt, windowMs: zPosInt, ttlMs: zPosInt, reconnectCollapseMs: zPosInt }),
    R3d: z.strictObject({ mode: zMode, threshold: zPosInt, windowMs: zPosInt }),
  }),
});

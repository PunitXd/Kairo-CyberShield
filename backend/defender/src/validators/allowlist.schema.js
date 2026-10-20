// /api/allowlist and the false-positive body (ARCH §9.2).
//
// An operator's free text (reason, note) is stored in Mongo, so it must not
// become a side channel for personal data: anything that looks like an email
// or an IP address is refused. Allowlisting reduces protection, so it always
// expires: 1 to 24 hours (BRIEF Flow B offers 24 h).

import { isIP } from 'node:net';

import { z } from 'zod';

export const MAX_ALLOW_HOURS = 24;

const LOOKS_PERSONAL = /@|\b\d{1,3}(\.\d{1,3}){3}\b|[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}/i;
const zText = z
  .string()
  .trim()
  .max(80)
  .refine((s) => !LOOKS_PERSONAL.test(s), 'no emails or IP addresses in free text');
const zHex16 = z.string().regex(/^[0-9a-f]{16}$/, 'expected a 16-hex hash');
const zHours = z.number().int().min(1).max(MAX_ALLOW_HOURS);

export const allowlistBodySchema = z
  .strictObject({
    ip: z.string().max(45).refine((s) => isIP(s) !== 0, 'expected an IP address').optional(),
    subject: zHex16.optional(),
    reason: zText.optional(),
    hours: zHours.default(MAX_ALLOW_HOURS),
  })
  .refine((b) => Boolean(b.ip) !== Boolean(b.subject), 'give exactly one of ip or subject');

export const allowlistParamsSchema = z.strictObject({ subject: zHex16 });

export const falsePositiveBodySchema = z.strictObject({
  note: zText.optional(),
  allowlistHours: zHours.optional(),
});

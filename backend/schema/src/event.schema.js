// SecurityEvent schema v1 (ARCH §5.2), Demo MVP subset.
//
// Validated twice: by the hooks before XADD and by the Defender after
// XREADGROUP. Every object is a z.strictObject, so an unknown field is a bug
// and is rejected, never passed through. There is deliberately no field that
// could hold message text, ciphertext, keys, raw room codes, raw IPs or emails:
// every identifier is a 16-hex HMAC (see utils/hasher.js).
//
// Vendored into CypherFy (backend/src/kairo/) by scripts/syncHooks.sh, so it
// may only import `zod` (CypherFy's own dependency) and relative files.

import { z } from 'zod';

import { AUTH_ROUTES, ROOM_ERRORS, SCHEMA_VERSION, SCOPES } from './event.constant.js';

export const zHex16 = z.string().regex(/^[0-9a-f]{16}$/, 'expected a 16-hex hash');

const base = {
  ts: z.number().int().positive(),
  env: z.enum(['staging', 'production', 'local']),
  inst: z.string().min(1).max(32),
  src: z.strictObject({
    ipHash: zHex16,
    client: z.enum(['web', 'flutter', 'unknown']),
    authed: z.boolean(),
    userHash: zHex16.optional(),
    sessionKey: zHex16.optional(),
  }),
};

const auth = z.strictObject({
  route: z.enum(AUTH_ROUTES),
  status: z.number().int().min(100).max(599),
  accountHash: zHex16.optional(),
});

const room = z.strictObject({
  codeHash: zHex16,
  kind: z.enum(['ephemeral', 'permanent']),
  via: z.enum(['socket', 'http']),
  error: z.enum(ROOM_ERRORS).optional(),
});

const http = z.strictObject({
  scope: z.enum(SCOPES),
  rule: z.string().max(8).regex(/^R[0-9][a-z]?$/, 'expected a rule id like R1b'),
});

export const securityEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('auth.fail'), auth }),
  z.strictObject({ ...base, type: z.literal('auth.success'), auth }),
  z.strictObject({ ...base, type: z.literal('room.join.invalid'), room }),
  z.strictObject({ ...base, type: z.literal('http.denied'), http }),
]);

/** Validate an event; throws a ZodError on anything outside the schema. */
export const parseEvent = (value) => securityEventSchema.parse(value);

/** Validate without throwing: { success, data } or { success, error }. */
export const safeParseEvent = (value) => securityEventSchema.safeParse(value);

/**
 * Stream entry layout (ARCH §5.1): two fields, `v` (schema version) and `e`
 * (the event as JSON). Validates first, so nothing invalid reaches Redis.
 * @returns {string[]} flat field/value list for XADD
 */
export const toStreamFields = (event) => ['v', SCHEMA_VERSION, 'e', JSON.stringify(parseEvent(event))];

/**
 * Inverse of toStreamFields for one XREADGROUP entry's flat field list.
 * Returns { success, data } or { success: false, error } and never throws,
 * because entries come from Redis and may be malformed.
 */
export const fromStreamFields = (fields) => {
  const map = {};
  for (let i = 0; i + 1 < fields.length; i += 2) map[fields[i]] = fields[i + 1];
  if (map.v !== SCHEMA_VERSION) {
    return { success: false, error: new Error(`unsupported schema version: ${String(map.v).slice(0, 8)}`) };
  }
  let json;
  try {
    json = JSON.parse(map.e);
  } catch {
    return { success: false, error: new Error('event is not valid JSON') };
  }
  return safeParseEvent(json);
};

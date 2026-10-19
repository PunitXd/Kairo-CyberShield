// The event contract for GET /api/schema and the Privacy screen (BRIEF §6 S8,
// principle 3). "Received" is generated from the strict zod schema the hooks
// and the Defender actually enforce, so the screen cannot drift from reality:
// a field that isn't in the schema can't be listed, and a schema field without
// a description fails a test.

import { z } from 'zod';
import { SCHEMA_VERSION, EVENT_TYPES, securityEventSchema } from 'kairo-schema';

const HEX16_PATTERN = '^[0-9a-f]{16}$';

/** Plain-language description and an example for every field in the schema. */
export const FIELD_DOCS = {
  ts: { note: 'When the hooks observed it, in ms', example: 1760800000123 },
  type: { note: 'Which signal this is', example: 'auth.fail' },
  env: { note: 'Environment the event came from', example: 'staging' },
  inst: { note: 'CypherFy backend instance name', example: 'cypherfy-backend-1' },
  'src.ipHash': { note: 'HMAC of the source IP; the IP itself never leaves CypherFy', example: '3e9a5b0c1d2e44c1' },
  'src.client': { note: 'Client type header; informational, never an exemption', example: 'unknown' },
  'src.authed': { note: 'Whether CypherFy had already authenticated the request', example: false },
  'src.userHash': { note: 'HMAC of the account id, only when logged in', example: 'a1b2c3d4e5f60718' },
  'src.sessionKey': { note: 'HMAC of the session id, to group reconnects', example: '0f1e2d3c4b5a6978' },
  'src.socketId': { note: 'Socket.io connection id: random, not personal', example: 'f21c9Qk3xY0aBcD' },
  'auth.route': { note: 'Which auth endpoint answered', example: 'login' },
  'auth.status': { note: 'The HTTP status code it returned', example: 401 },
  'auth.accountHash': { note: 'HMAC of the lowercased email; the email is dropped in the hook', example: 'a91f0c3e7b2d10f8' },
  'room.codeHash': { note: 'HMAC of the room code; the code is the room key and never leaves CypherFy', example: 'af47772dad981591' },
  'room.kind': { note: 'Ephemeral or permanent room', example: 'ephemeral' },
  'room.via': { note: 'How the lookup arrived', example: 'http' },
  'room.error': { note: "CypherFy's own error code", example: 'ROOM_NOT_FOUND' },
  'http.scope': { note: 'Which Kairo scope refused the request', example: 'auth' },
  'http.rule': { note: 'The rule whose block or throttle applied', example: 'R1b' },
  'sock.counts': { note: 'Packets per event name in one second; names only, never the payload', example: { send_message: 41, typing_start: 3 } },
  'sock.total': { note: 'All packets from this socket in that second', example: 44 },
  'sock.windowMs': { note: 'Length of the counting bucket', example: 1000 },
  'sock.event': { note: 'Which CypherFy event had a malformed payload; the payload is never sent', example: 'join_room' },
  'ack.actionId': { note: 'The Kairo action the hooks just carried out', example: '01JAB3K5Q8ZP4M2N7R9T1V6W0X' },
  'ack.ok': { note: 'Whether it succeeded', example: true },
};

/** What Kairo never receives (BRIEF §11: one honest phrase each). */
export const NEVER_RECEIVED = [
  'Message text',
  'Ciphertext',
  'IVs',
  'Encryption keys',
  'Salts',
  'Passphrases',
  'Passwords and OTPs',
  'Raw room codes',
  'Raw IP addresses',
  'Email addresses',
  'File names',
].map((item) => ({ item, note: 'Not in the event schema' }));

const typeLabel = (prop) => {
  if (prop.type === 'object' && prop.additionalProperties) return 'event name → packet count';
  if (prop.const) return `"${prop.const}"`;
  if (prop.enum) return prop.enum.map((v) => `"${v}"`).join(' | ');
  if (prop.pattern === HEX16_PATTERN) return '16-hex HMAC hash';
  return prop.type;
};

/** Flatten the zod schema into one row per field path, across event types. */
export const describeEventSchema = () => {
  const json = z.toJSONSchema(securityEventSchema);
  const fields = new Map(); // path -> { type, carriedBy: Set, required: boolean }

  const walk = (props, required, prefix, eventType) => {
    for (const [name, prop] of Object.entries(props)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (prop.type === 'object' && prop.properties) {
        walk(prop.properties, prop.required ?? [], path, eventType);
        continue;
      }
      const row = fields.get(path) ?? { type: typeLabel(prop), carriedBy: new Set(), required: true };
      if (path === 'type') row.type = 'event type';
      row.carriedBy.add(eventType);
      row.required &&= required.includes(name);
      fields.set(path, row);
    }
  };
  for (const option of json.oneOf) walk(option.properties, option.required ?? [], '', option.properties.type.const);

  return [...fields].map(([path, row]) => ({
    field: path,
    type: row.type,
    carriedBy: row.carriedBy.size === EVENT_TYPES.length ? ['all'] : [...row.carriedBy].sort(),
    required: row.required,
    note: FIELD_DOCS[path]?.note ?? null,
    example: FIELD_DOCS[path]?.example ?? null,
  }));
};

export const getEventContract = () => ({
  schemaVersion: SCHEMA_VERSION,
  eventTypes: EVENT_TYPES,
  hashing: 'HMAC-SHA256 with a per-environment secret, truncated to 16 hex characters, computed inside CypherFy',
  received: describeEventSchema(),
  neverReceived: NEVER_RECEIVED,
  scope: "This describes what Kairo Shield receives. CypherFy's own encryption model is documented separately.",
});

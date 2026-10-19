// Event vocabulary shared by the hooks and the Defender (ARCH §5.2), Demo MVP
// subset: schema version, event types, scopes, routes and rule families.

export const SCHEMA_VERSION = '1';

export const EVENT_TYPES = ['auth.fail', 'auth.success', 'room.join.invalid', 'http.denied'];

// Scopes a block or throttle can apply to. `socket` joins when R3 does.
export const SCOPES = ['auth', 'room_join'];

export const AUTH_ROUTES = [
  'login',
  'register',
  'verify_otp',
  'reset_password',
  'forgot_password',
  'firebase',
  'refresh',
  'verify_email',
];

export const ROOM_ERRORS = ['ROOM_NOT_FOUND', 'INVALID_CODE', 'ROOM_FULL', 'WRONG_PASSPHRASE'];

export const RULE_FAMILIES = ['auth', 'room'];

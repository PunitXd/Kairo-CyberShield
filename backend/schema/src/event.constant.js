// Event vocabulary shared by the hooks and the Defender (ARCH §5.2): schema
// version, event types, scopes, routes and rule families.

export const SCHEMA_VERSION = '1';

export const EVENT_TYPES = [
  'auth.fail',
  'auth.success',
  'room.join.invalid',
  'room.join.success',
  'room.join.denied',
  'http.denied',
  'socket.connect',
  'socket.disconnect',
  'socket.rate',
  'socket.invalid_payload',
  'kairo.ack',
];

// Scopes a block or throttle can apply to.
export const SCOPES = ['auth', 'room_join', 'socket'];

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

export const RULE_FAMILIES = ['auth', 'room', 'socket'];

// socket.rate carries per-event packet counts. Event names come from the client,
// so they are bounded: identifier-like, at most 32 chars, at most this many per bucket.
export const MAX_SOCKET_EVENT_NAMES = 20;

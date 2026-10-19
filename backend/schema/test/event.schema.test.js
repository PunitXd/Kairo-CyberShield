import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_TYPES,
  SCHEMA_VERSION,
  fromStreamFields,
  parseEvent,
  safeParseEvent,
  toStreamFields,
} from '../src/index.js';

const H = '3e9a5b0c1d2e44c1';
const src = { ipHash: H, client: 'unknown', authed: false };
const common = { ts: 1760800000123, env: 'staging', inst: 'cypherfy-backend-1', src };

const SID = 'f21c9Qk3xY0aBcD-_1';
const sockSrc = { ...src, socketId: SID };
const onSocket = { ...common, src: sockSrc };

const valid = {
  'auth.fail': { ...common, type: 'auth.fail', auth: { route: 'login', status: 401, accountHash: 'a91f0c3e7b2d10f8' } },
  'auth.success': { ...common, type: 'auth.success', auth: { route: 'login', status: 200 } },
  'room.join.invalid': { ...common, type: 'room.join.invalid', room: { codeHash: H, kind: 'ephemeral', via: 'http' } },
  'room.join.success': { ...onSocket, type: 'room.join.success', room: { codeHash: H, kind: 'ephemeral', via: 'socket' } },
  'room.join.denied': { ...onSocket, type: 'room.join.denied', room: { codeHash: H, kind: 'ephemeral', via: 'socket' } },
  'http.denied': { ...common, type: 'http.denied', http: { scope: 'auth', rule: 'R1b' } },
  'socket.connect': { ...onSocket, type: 'socket.connect' },
  'socket.disconnect': { ...onSocket, type: 'socket.disconnect' },
  'socket.rate': { ...onSocket, type: 'socket.rate', sock: { counts: { send_message: 41, typing_start: 3 }, total: 44, windowMs: 1000 } },
  'socket.invalid_payload': { ...onSocket, type: 'socket.invalid_payload', sock: { event: 'join_room' } },
  'kairo.ack': { ...onSocket, type: 'kairo.ack', ack: { actionId: '01JAB3K5Q8ZP4M2N7R9T1V6W0X', ok: true } },
};

const rejects = (event, why) => assert.equal(safeParseEvent(event).success, false, why);

test('every event type has a valid example that parses unchanged', () => {
  assert.deepEqual(Object.keys(valid).sort(), [...EVENT_TYPES].sort());
  for (const event of Object.values(valid)) assert.deepEqual(parseEvent(event), event);
});

test('unknown top-level fields are rejected, not stripped', () => {
  for (const extra of ['message', 'ciphertext', 'iv', 'text', 'key', 'payload', 'email', 'ip']) {
    rejects({ ...valid['auth.fail'], [extra]: 'x' }, `top-level ${extra} must be rejected`);
  }
});

test('unknown nested fields are rejected', () => {
  rejects({ ...valid['auth.fail'], src: { ...src, ip: '172.18.0.5' } }, 'src.ip');
  rejects({ ...valid['auth.fail'], src: { ...src, email: 'demo01@kairo.test' } }, 'src.email');
  rejects({ ...valid['auth.fail'], auth: { ...valid['auth.fail'].auth, password: 'hunter2' } }, 'auth.password');
  rejects({ ...valid['auth.fail'], auth: { ...valid['auth.fail'].auth, email: 'demo01@kairo.test' } }, 'auth.email');
  rejects({ ...valid['room.join.invalid'], room: { ...valid['room.join.invalid'].room, code: 'XK9PLM' } }, 'room.code');
  rejects({ ...valid['http.denied'], http: { ...valid['http.denied'].http, path: '/api/v1/rooms/XK9PLM' } }, 'http.path');
});

test('raw identifiers cannot be smuggled into hash fields', () => {
  rejects({ ...valid['auth.fail'], src: { ...src, ipHash: '172.18.0.5' } }, 'raw IP as ipHash');
  rejects({ ...valid['auth.fail'], auth: { ...valid['auth.fail'].auth, accountHash: 'demo01@kairo.test' } }, 'raw email as accountHash');
  rejects({ ...valid['room.join.invalid'], room: { ...valid['room.join.invalid'].room, codeHash: 'XK9PLM' } }, 'raw code as codeHash');
  rejects({ ...valid['auth.fail'], src: { ...src, ipHash: H.toUpperCase() } }, 'uppercase hex is not our format');
  rejects({ ...valid['auth.fail'], src: { ...src, ipHash: H + '00' } }, 'longer than 16 hex');
});

test('each type only accepts its own section', () => {
  rejects({ ...valid['auth.fail'], room: valid['room.join.invalid'].room }, 'auth.fail with room');
  rejects({ ...valid['room.join.invalid'], auth: valid['auth.fail'].auth }, 'room.join.invalid with auth');
  const { auth: _auth, ...noAuth } = valid['auth.fail'];
  rejects(noAuth, 'auth.fail without auth');
});

test('types, enums and bounds outside the schema are rejected', () => {
  rejects({ ...valid['auth.fail'], type: 'socket.flood' }, 'unknown type');
  rejects({ ...valid['http.denied'], http: { scope: 'everything', rule: 'R3b' } }, 'unknown scope');
  rejects({ ...valid['http.denied'], http: { scope: 'auth', rule: 'DROP TABLE' } }, 'rule id format');
  rejects({ ...valid['auth.fail'], env: 'prod' }, 'env enum');
  rejects({ ...valid['auth.fail'], inst: 'x'.repeat(33) }, 'inst max 32');
  rejects({ ...valid['auth.fail'], ts: 1.5 }, 'ts must be an integer');
  rejects({ ...valid['auth.fail'], auth: { route: 'login', status: 99 } }, 'status range');
});

test('stream fields round-trip and refuse anything invalid', () => {
  const fields = toStreamFields(valid['auth.fail']);
  assert.equal(fields[0], 'v');
  assert.equal(fields[1], SCHEMA_VERSION);
  assert.deepEqual(fromStreamFields(fields), { success: true, data: valid['auth.fail'] });

  assert.throws(() => toStreamFields({ ...valid['auth.fail'], message: 'hi' }), 'invalid events never reach XADD');
  assert.equal(fromStreamFields(['v', '2', 'e', fields[3]]).success, false, 'unknown version');
  assert.equal(fromStreamFields(['v', '1', 'e', '{not json']).success, false, 'bad JSON');
  assert.equal(fromStreamFields(['v', '1', 'e', JSON.stringify({ ...valid['auth.fail'], email: 'a@b.c' })]).success, false);
});

test('validation errors do not echo the rejected value', () => {
  const secret = 'demo01@kairo.test';
  const result = safeParseEvent({ ...valid['auth.fail'], auth: { ...valid['auth.fail'].auth, accountHash: secret } });
  assert.equal(result.success, false);
  assert.ok(!JSON.stringify(result.error.issues).includes(secret), 'issues must not contain the raw input');
});

test('the socket scope is accepted for refusals', () => {
  assert.equal(safeParseEvent({ ...valid['http.denied'], src: sockSrc, http: { scope: 'socket', rule: 'R3b' } }).success, true);
});

test('socket events must name their socket; HTTP-only events must not', () => {
  for (const type of ['socket.connect', 'socket.disconnect', 'socket.rate', 'socket.invalid_payload', 'kairo.ack']) {
    rejects({ ...valid[type], src }, `${type} without socketId`);
  }
  rejects({ ...valid['auth.fail'], src: sockSrc }, 'auth.fail is HTTP only');
  rejects({ ...valid['socket.connect'], src: { ...sockSrc, socketId: 'has spaces in it' } }, 'socket id format');
  rejects({ ...valid['socket.connect'], src: { ...sockSrc, socketId: 'x'.repeat(33) } }, 'socket id length');
});

test('socket sections reject unknown fields and payload content', () => {
  for (const type of ['socket.rate', 'socket.invalid_payload']) {
    rejects({ ...valid[type], sock: { ...valid[type].sock, payload: 'hello' } }, `${type} sock.payload`);
  }
  rejects({ ...valid['socket.connect'], sock: { total: 1 } }, 'socket.connect has no sock section');
  rejects({ ...valid['kairo.ack'], ack: { ...valid['kairo.ack'].ack, socketId: SID } }, 'ack.socketId');
  rejects({ ...valid['socket.rate'], message: 'hi' }, 'top-level message');
});

test('client-chosen event names cannot carry text', () => {
  const rate = (counts) => ({ ...valid['socket.rate'], sock: { counts, total: 1, windowMs: 1000 } });
  rejects(rate({ 'hello how are you': 1 }), 'spaces');
  rejects(rate({ ['a'.repeat(33)]: 1 }), 'over 32 chars');
  rejects(rate({ '{"text":"hi"}': 1 }), 'JSON');
  rejects(rate(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`ev${i}`, 1]))), 'more than 20 names');
  rejects(rate({ send_message: 0 }), 'zero count');
  rejects({ ...valid['socket.invalid_payload'], sock: { event: 'join room now' } }, 'invalid_payload event name');
});

test('kairo.ack needs a ulid action id and a boolean', () => {
  rejects({ ...valid['kairo.ack'], ack: { actionId: 'not-a-ulid', ok: true } }, 'actionId format');
  rejects({ ...valid['kairo.ack'], ack: { actionId: '01JAB3K5Q8ZP4M2N7R9T1V6W0X', ok: 'yes' } }, 'ok boolean');
});

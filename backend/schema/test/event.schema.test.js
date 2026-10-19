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

const valid = {
  'auth.fail': { ...common, type: 'auth.fail', auth: { route: 'login', status: 401, accountHash: 'a91f0c3e7b2d10f8' } },
  'auth.success': { ...common, type: 'auth.success', auth: { route: 'login', status: 200 } },
  'room.join.invalid': { ...common, type: 'room.join.invalid', room: { codeHash: H, kind: 'ephemeral', via: 'http' } },
  'http.denied': { ...common, type: 'http.denied', http: { scope: 'auth', rule: 'R1b' } },
};

const rejects = (event, why) => assert.equal(safeParseEvent(event).success, false, why);

test('every MVP event type has a valid example that parses unchanged', () => {
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

test('types, enums and bounds outside the MVP schema are rejected', () => {
  rejects({ ...valid['auth.fail'], type: 'socket.rate' }, 'socket.rate is not in the Demo MVP');
  rejects({ ...valid['http.denied'], http: { scope: 'socket', rule: 'R3b' } }, 'socket scope is cut');
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

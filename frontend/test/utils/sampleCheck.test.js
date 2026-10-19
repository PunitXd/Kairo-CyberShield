import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkSample } from '../../src/utils/sampleCheck.js';

const clean = {
  ts: 1760800000123,
  type: 'room.join.invalid',
  env: 'staging',
  inst: 'cypherfy-backend-1',
  src: { ipHash: '3e9a5b0c1d2e44c1', client: 'unknown', authed: false },
  room: { codeHash: 'af47772dad981591', kind: 'ephemeral', via: 'http', error: 'ROOM_NOT_FOUND' },
};

test('a real metadata-only event passes every check', () => {
  assert.deepEqual(checkSample([clean, clean]), { count: 2, ipAddress: false, email: false, roomCode: false });
});

test('it flags raw IPs, emails and room codes if they ever appeared', () => {
  assert.equal(checkSample([{ ...clean, ip: '172.18.0.5' }]).ipAddress, true);
  assert.equal(checkSample([{ ...clean, ip: '::ffff:172.18.0.5' }]).ipAddress, true);
  assert.equal(checkSample([{ ...clean, email: 'demo01@kairo.test' }]).email, true);
  // CypherFy's alphabet has no 0, O, 1, I or L, so a real code looks like this:
  assert.equal(checkSample([{ ...clean, room: { code: 'XK9PMN' } }]).roomCode, true);
});

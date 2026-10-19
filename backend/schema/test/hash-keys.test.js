import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KEYS, createHasher, normalizeIp } from '../src/index.js';

// Low-entropy fixture so secret scanners don't mistake it for a real key.
const SECRET = 'fixture'.repeat(6);
const HEX16 = /^[0-9a-f]{16}$/;

test('createHasher refuses a missing or short secret', () => {
  assert.throws(() => createHasher(undefined));
  assert.throws(() => createHasher(''));
  assert.throws(() => createHasher('short'));
});

test('hashes are 16 hex, deterministic, and depend on the secret', () => {
  const a = createHasher(SECRET);
  const b = createHasher('other'.repeat(8));
  assert.match(a.ip('172.18.0.5'), HEX16);
  assert.equal(a.ip('172.18.0.5'), a.ip('172.18.0.5'));
  assert.notEqual(a.ip('172.18.0.5'), b.ip('172.18.0.5'));
});

test('normalisation makes equivalent identifiers hash the same', () => {
  const h = createHasher(SECRET);
  assert.equal(normalizeIp('::ffff:172.18.0.5'), '172.18.0.5');
  assert.equal(h.ip('::ffff:172.18.0.5'), h.ip('172.18.0.5'));
  assert.equal(h.ip('FE80::1'), h.ip('fe80::1'));
  assert.equal(h.account(' Demo01@Kairo.TEST '), h.account('demo01@kairo.test'));
  assert.equal(h.roomCode('xk9plm'), h.roomCode('XK9PLM'));
});

test('prefixes keep identifier kinds apart', () => {
  const h = createHasher(SECRET);
  const value = 'XK9PLM';
  const all = [h.ip(value), h.account(value), h.roomCode(value), h.user(value), h.session(value)];
  assert.equal(new Set(all).size, all.length);
});

test('the raw value never appears in the hash', () => {
  const h = createHasher(SECRET);
  for (const raw of ['172.18.0.5', 'demo01@kairo.test', 'XK9PLM']) {
    assert.ok(!h.ip(raw).includes(raw) && !h.account(raw).includes(raw.toLowerCase()));
  }
});

test('key builders produce ARCH §8.1 names', () => {
  const s = '3e9a5b0c1d2e44c1';
  assert.equal(KEYS.events, 'kairo:events');
  assert.equal(KEYS.block('auth', s), `kairo:block:auth:${s}`);
  assert.equal(KEYS.throttle('auth', s), `kairo:throttle:auth:${s}`);
  assert.equal(KEYS.tokenGate('auth', s), `kairo:tb:auth:${s}`);
  assert.equal(KEYS.block('room_join', s), `kairo:block:room_join:${s}`);
  assert.equal(KEYS.allow(s), `kairo:allow:${s}`);
  assert.equal(KEYS.strikes('auth', s), `kairo:strikes:auth:${s}`);
  assert.equal(KEYS.openIncident('room', s), `kairo:inc:open:room:${s}`);
  assert.equal(KEYS.hooksHeartbeat('cypherfy-backend-1'), 'kairo:hb:hooks:cypherfy-backend-1');
});

test('key builders refuse raw identifiers and unknown scopes', () => {
  assert.throws(() => KEYS.block('auth', '172.18.0.5'));
  assert.throws(() => KEYS.block('auth', 'demo01@kairo.test'));
  assert.throws(() => KEYS.allow('XK9PLM'));
  assert.throws(() => KEYS.block('socket', '3e9a5b0c1d2e44c1'));
  assert.throws(() => KEYS.strikes('everything', '3e9a5b0c1d2e44c1'));
  assert.equal(KEYS.hooksHeartbeat('a:b*c'), 'kairo:hb:hooks:a_b_c');
});

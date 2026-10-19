import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KEYS } from '../src/index.js';

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

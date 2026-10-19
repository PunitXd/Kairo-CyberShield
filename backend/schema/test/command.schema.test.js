import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KEYS, parseCommand } from '../src/index.js';

const ID = '01JAB3K5Q8ZP4M2N7R9T1V6W0X';
const disconnect = { v: 1, actionId: ID, op: 'disconnect_socket', socketId: 'f21c9Qk3xY0aBcD' };
const throttle = { v: 1, actionId: ID, op: 'throttle_socket', socketId: 'f21c9Qk3xY0aBcD', maxPerSec: 3, ttlMs: 10_000 };
const parse = (o) => parseCommand(JSON.stringify(o));

test('both command types parse; the channel is kairo:commands', () => {
  assert.deepEqual(parse(disconnect).data, disconnect);
  assert.deepEqual(parse(throttle).data, throttle);
  assert.equal(KEYS.commands, 'kairo:commands');
});

test('anything else is refused, never thrown', () => {
  for (const [why, msg] of [
    ['not JSON', '{nope'],
    ['not a string', 42],
    ['too long', JSON.stringify({ ...disconnect, pad: 'x'.repeat(2000) })],
    ['unknown op', JSON.stringify({ ...disconnect, op: 'drop_table' })],
    ['extra field', JSON.stringify({ ...disconnect, code: 'XK9PLM' })],
    ['bad socket id', JSON.stringify({ ...disconnect, socketId: '../../etc' })],
    ['bad action id', JSON.stringify({ ...disconnect, actionId: 'abc' })],
    ['wrong version', JSON.stringify({ ...disconnect, v: 2 })],
    ['rate out of range', JSON.stringify({ ...throttle, maxPerSec: 0 })],
    ['ttl out of range', JSON.stringify({ ...throttle, ttlMs: 3_600_000 })],
    ['throttle without rate', JSON.stringify({ ...disconnect, op: 'throttle_socket' })],
  ]) {
    assert.equal(parseCommand(msg).success, false, why);
  }
});

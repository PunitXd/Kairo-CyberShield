import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIELD_DOCS, NEVER_RECEIVED, describeEventSchema, getEventContract } from '../../src/services/schema.service.js';

test('DRIFT GUARD: every field in the enforced schema is described, and nothing else is', () => {
  const fields = describeEventSchema().map((f) => f.field).sort();
  assert.deepEqual(fields, Object.keys(FIELD_DOCS).sort());
});

test('every received field is a hash, a code, a count, a route, a status or a small enum, never raw content', () => {
  const FORBIDDEN_LEAF = /^(ip|email|password|otp|code|message|text|body|ciphertext|iv|key|salt|passphrase|filename|token)$/i;
  for (const f of describeEventSchema()) {
    const leaf = f.field.split('.').at(-1);
    assert.ok(!FORBIDDEN_LEAF.test(leaf), `${f.field} looks like raw content`);
    if (/Hash$|^sessionKey$/.test(leaf)) assert.equal(f.type, '16-hex HMAC hash', f.field);
  }
});

test('carriedBy and required follow the schema', () => {
  const byField = Object.fromEntries(describeEventSchema().map((f) => [f.field, f]));
  assert.deepEqual(byField['src.ipHash'].carriedBy, ['all']);
  assert.equal(byField['src.ipHash'].required, true);
  assert.deepEqual(byField['auth.accountHash'].carriedBy, ['auth.fail', 'auth.success']);
  assert.equal(byField['auth.accountHash'].required, false);
  assert.deepEqual(byField['room.codeHash'].carriedBy, ['room.join.invalid']);
  assert.equal(byField['http.scope'].type, '"auth" | "room_join"');
});

test('never received lists the content Kairo must not see, each "Not in the event schema"', () => {
  const items = NEVER_RECEIVED.map((n) => n.item);
  for (const required of ['Message text', 'Ciphertext', 'Encryption keys', 'Salts', 'Passphrases', 'Raw room codes', 'Raw IP addresses', 'Email addresses', 'File names']) {
    assert.ok(items.includes(required), required);
  }
  assert.ok(NEVER_RECEIVED.every((n) => n.note === 'Not in the event schema'));
});

test('the contract says HMAC and scopes its claim to Kairo, not to CypherFy (PRD Q11)', () => {
  const c = getEventContract();
  assert.match(c.hashing, /^HMAC-SHA256/);
  assert.match(c.scope, /what Kairo Shield receives/);
  assert.doesNotMatch(JSON.stringify(c), /zero[- ]knowledge|zk-SNARK|gRPC|cannot read messages/i);
});

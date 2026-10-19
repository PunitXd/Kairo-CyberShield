import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertAllowedTarget, isForbiddenHost, isPrivateAddress } from './targetGuard.js';

test('isPrivateAddress: loopback and RFC 1918 / unique-local only', () => {
  for (const ok of ['127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.0.3', '172.31.255.1', '::1', 'fd00::1', '::ffff:10.1.2.3']) {
    assert.equal(isPrivateAddress(ok), true, ok);
  }
  for (const no of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '169.254.1.1', '2606:4700::1', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(no), false, no);
  }
});

test('isForbiddenHost: the live site and its subdomains, case- and dot-insensitive', () => {
  for (const h of ['cypherfy.in', 'CYPHERFY.IN', 'api.cypherfy.in', 'staging.cypherfy.in', 'cypherfy.in.']) {
    assert.equal(isForbiddenHost(h), true, h);
  }
  for (const h of ['cypherfy.in.evil.com', 'notcypherfy.in', 'localhost', 'cypherfy-backend']) {
    assert.equal(isForbiddenHost(h), false, h);
  }
});

test('assertAllowedTarget allows localhost, loopback and private literals', async () => {
  for (const t of ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://192.168.1.20:8000', 'http://10.0.0.5/api']) {
    const { hostname } = await assertAllowedTarget(t);
    assert.ok(hostname);
  }
});

test('assertAllowedTarget refuses cypherfy.in and its subdomains, with or without a path', async () => {
  for (const t of ['https://cypherfy.in', 'https://cypherfy.in/api/v1/auth/login', 'http://api.cypherfy.in:8000']) {
    await assert.rejects(assertAllowedTarget(t), /never allowed/, t);
  }
});

test('assertAllowedTarget refuses a public IP literal', async () => {
  await assert.rejects(assertAllowedTarget('http://8.8.8.8:8000'), /non-private address/);
  await assert.rejects(assertAllowedTarget('http://1.1.1.1'), /non-private address/);
});

test('assertAllowedTarget refuses a hostname that resolves to a public address', async () => {
  // example.com resolves to public addresses; the guard must reject it on the
  // resolved IP even though the name is not on the forbidden list.
  await assert.rejects(assertAllowedTarget('http://example.com'), /non-private address|could not resolve/);
});

test('assertAllowedTarget rejects non-URLs and non-http protocols', async () => {
  await assert.rejects(assertAllowedTarget('not a url'), /valid URL/);
  await assert.rejects(assertAllowedTarget('ftp://127.0.0.1'), /unsupported protocol/);
});

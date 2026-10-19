import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApp } from '../../src/app.js';
import { createDashboardRouter } from '../../src/middlewares/dashboard.middleware.js';
import { fakeMongo, fakeRedis, listen, rawGet } from '../apiFakes.js';

const INDEX = '<!doctype html><title>Kairo Shield</title><div id="root"></div>';
let dir;
let server;
let port;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'kairo-public-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), INDEX);
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  const deps = { redis: fakeRedis(), mongo: fakeMongo(), env: 'staging', publicDir: dir, getConsumerStats: () => ({}), getRules: () => [] };
  server = createServer(createApp(deps));
  port = await listen(server);
});
after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('/ and every screen route serve index.html with a strict CSP and no caching', async () => {
  for (const route of ['/', '/blocks', '/pipeline', '/privacy', '/some/deep/route']) {
    const { status, headers, body } = await rawGet(port, route, { accept: 'text/html' });
    assert.equal(status, 200, route);
    assert.equal(body, INDEX, route);
    assert.match(headers['content-security-policy'], /default-src 'self'/);
    assert.match(headers['content-security-policy'], /connect-src 'self'/);
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['cache-control'], 'no-cache');
  }
});

test('hashed assets are cached immutably; a missing asset is a 404, not the page', async () => {
  const js = await rawGet(port, '/assets/index-abc123.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['cache-control'], /immutable/);
  assert.match(js.headers['cache-control'], /max-age=31536000/);

  const missing = await rawGet(port, '/assets/nope-xyz.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
  assert.notEqual(missing.body, INDEX);
});

test('unknown API paths and missing files never fall back to the page', async () => {
  const api = await rawGet(port, '/api/nope');
  assert.equal(api.status, 404);
  assert.deepEqual(api.body, { error: { code: 'NOT_FOUND', message: 'Resource not found' } });

  const file = await rawGet(port, '/favicon.ico');
  assert.equal(file.status, 404);
});

test('the API still works alongside the dashboard', async () => {
  const { status, body } = await rawGet(port, '/api/health');
  assert.equal(status, 200);
  assert.equal(body.defender, 'ok');
});

test('the page is refused for a foreign Host too (DNS rebinding)', async () => {
  const { status } = await rawGet(port, '/', { host: 'attacker.example:7070' });
  assert.equal(status, 403);
});

test('no public/ folder → no dashboard router (API-only mode)', () => {
  assert.equal(createDashboardRouter(path.join(tmpdir(), 'kairo-does-not-exist')), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CLEARED_COLLECTIONS, DEFENDER_URL, REDIS_URL, RESET_PATTERNS, checkResetEnv, resettable } from './demoReset.js';

const ready = { KAIRO_ENV: 'staging', KAIRO_DB_PASSWORD: 'x', DEMO_PASSWORD: 'y', DEMO_ROOM_CODE: 'ABC234' };

test('refuses to run outside staging or without the secrets it needs', () => {
  assert.deepEqual(checkResetEnv(ready), []);
  assert.match(checkResetEnv({ ...ready, KAIRO_ENV: 'production' })[0], /staging/);
  assert.match(checkResetEnv({ ...ready, KAIRO_ENV: undefined })[0], /staging/);
  assert.match(checkResetEnv({ ...ready, KAIRO_DB_PASSWORD: '' })[0], /KAIRO_DB_PASSWORD/);
  assert.match(checkResetEnv({ ...ready, DEMO_ROOM_CODE: undefined })[0], /reseed/);
});

test('only ever talks to the local stack', () => {
  assert.equal(new URL(REDIS_URL).hostname, '127.0.0.1');
  assert.equal(new URL(DEFENDER_URL).hostname, '127.0.0.1');
});

test('keeps pipeline runs and CypherFy data; deletes only Kairo state and the login backoff', () => {
  assert.ok(!CLEARED_COLLECTIONS.includes('pipeline_runs'));
  assert.deepEqual(RESET_PATTERNS, ['kairo:*', 'cypherfy:authbackoff:*']);
  const source = readFileSync(new URL('./demoReset.js', import.meta.url), 'utf8');
  assert.ok(!/flushall|flushdb|dropDatabase/i.test(source.replace(/never FLUSHALL/g, '')), 'no blanket wipes');
});

test('reset keeps the hooks heartbeat (live state), deletes the demo state', () => {
  assert.deepEqual(
    resettable(['kairo:block:auth:3e9a5b0c1d2e44c1', 'kairo:hb:hooks:cypherfy-backend-1', 'kairo:rollback:budget', 'kairo:events']),
    ['kairo:block:auth:3e9a5b0c1d2e44c1', 'kairo:rollback:budget', 'kairo:events']
  );
});

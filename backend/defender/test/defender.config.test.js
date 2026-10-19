import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isLocalMongo, readEnv, readGithubEnv } from '../src/defender.config.js';
import { CONFIG } from './helpers.js';

test('staging refuses to start against a non-local Mongo (ARCH §11.1)', () => {
  const base = { KAIRO_ENV: 'staging', KAIRO_REDIS_URL: 'redis://redis:6379' };
  assert.doesNotThrow(() => readEnv({ ...base, KAIRO_MONGO_URI: 'mongodb://kairo_defender:x@mongo:27017/kairo' }));
  for (const uri of [
    'mongodb+srv://user:pw@cluster0.abcde.mongodb.net/kairo',
    'mongodb://user:pw@db.example.com:27017/kairo',
    'mongodb://user:pw@mongo:27017,db.example.com:27017/kairo',
    'mongodb://user:pw@8.8.8.8:27017/kairo',
  ]) {
    assert.throws(() => readEnv({ ...base, KAIRO_MONGO_URI: uri }), /not a local host/, uri);
  }
});

test('isLocalMongo accepts the Compose service, loopback and private ranges only', () => {
  for (const ok of ['mongodb://mongo:27017/k', 'mongodb://localhost/k', 'mongodb://127.0.0.1/k', 'mongodb://10.0.0.5/k', 'mongodb://192.168.1.20/k', 'mongodb://172.20.0.3/k']) {
    assert.equal(isLocalMongo(ok), true, ok);
  }
  for (const bad of ['mongodb://172.32.0.1/k', 'mongodb://mongo.example.com/k', 'not a uri']) {
    assert.equal(isLocalMongo(bad), false, bad);
  }
});

test('readGithubEnv: repo optional but validated, token optional, sane poll interval', () => {
  assert.deepEqual(readGithubEnv({}), { repo: null, token: null, pollMs: 15_000 });
  assert.deepEqual(readGithubEnv({ GITHUB_REPO: 'PunitXd/CypherFy', GITHUB_TOKEN: 't', GITHUB_POLL_MS: '30000' }), {
    repo: 'PunitXd/CypherFy',
    token: 't',
    pollMs: 30_000,
  });
  assert.equal(readGithubEnv({ GITHUB_POLL_MS: '100' }).pollMs, 15_000); // too fast for GitHub's limits
  assert.throws(() => readGithubEnv({ GITHUB_REPO: 'https://github.com/x/y' }), /owner\/name/);
  assert.throws(() => readGithubEnv({ GITHUB_REPO: '../../etc' }), /owner\/name/);
  assert.throws(() => readGithubEnv({ GITHUB_REPO: '../etc' }), /owner\/name/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createGithubPoller } from '../../src/pollers/github.poller.js';
import { makeZip } from '../zipFixture.js';

const REPO = 'PunitXd/CypherFy';
const TOKEN = 'test-token-not-real';
const API = 'https://api.example';
const BLOB = 'https://blob.example/artifact.zip?sig=abc';
const FAKE_KEY = ['AK', 'IA', 'Q3', 'TESTONLYNOTREAL'.padEnd(14, 'X')].join('');

const silentLog = { info() {}, warn() {}, error() {} };

const run = (over = {}) => ({
  id: 7,
  path: '.github/workflows/kairo-shield.yml',
  head_branch: 'demo/leaked-secret',
  head_sha: 'b4ecb3fb269ee2e797d2f836df34bf5e8871adf1',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  html_url: `https://github.com/${REPO}/actions/runs/7`,
  run_started_at: '2026-10-19T16:52:51Z',
  updated_at: '2026-10-19T16:53:06Z',
  pull_requests: [],
  head_commit: { message: 'Add R2 storage config' },
  ...over,
});

const job = (name, conclusion, status = 'completed') => ({
  name,
  status,
  conclusion,
  started_at: '2026-10-19T16:52:54Z',
  completed_at: status === 'completed' ? '2026-10-19T16:53:01Z' : null,
});

// Unredacted on purpose: the poller must redact again on its own.
const secretsZip = makeZip({
  'secrets.json': JSON.stringify([
    { RuleID: 'aws-access-token', File: 'backend/src/config/storage.js', StartLine: 8, Commit: '16784d8', Secret: FAKE_KEY, Match: FAKE_KEY, Email: 'dev@example.com' },
  ]),
});
const depsZip = makeZip({ 'deps-backend.json': JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }) });

/** Fake GitHub: responds by URL and records every request. */
const fakeGithub = ({ runs = [run()], jobs = [job('secrets', 'failure'), job('deps (backend)', 'success'), job('build', 'skipped')] } = {}) => {
  const state = { runs, jobs, etag: '"v1"', requests: [], down: false, rateLimited: false };
  state.fetch = async (url, init = {}) => {
    state.requests.push({ url, headers: { ...(init.headers ?? {}) }, redirect: init.redirect });
    if (state.down) throw new TypeError('fetch failed');
    if (state.rateLimited) {
      return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
    }
    if (url === BLOB) return new Response(state.blob ?? secretsZip, { status: 200 });
    if (url.startsWith(`${API}/repos/${REPO}/actions/workflows/kairo-shield.yml/runs`)) {
      if (init.headers?.['If-None-Match'] === state.etag) return new Response(null, { status: 304 });
      return Response.json({ workflow_runs: state.runs }, { headers: { etag: state.etag } });
    }
    if (/\/actions\/runs\/\d+\/jobs/.test(url)) return Response.json({ jobs: state.jobs });
    if (/\/actions\/runs\/\d+\/artifacts/.test(url)) {
      return Response.json({
        artifacts: [
          { id: 1, name: 'kairo-secrets', size_in_bytes: 600, expired: false },
          { id: 2, name: 'kairo-deps-backend', size_in_bytes: 300, expired: false },
          { id: 3, name: 'unrelated', size_in_bytes: 10, expired: false },
        ],
      });
    }
    if (url === `${API}/repos/${REPO}/actions/artifacts/1/zip`) return new Response(null, { status: 302, headers: { location: BLOB } });
    if (url === `${API}/repos/${REPO}/actions/artifacts/2/zip`) return new Response(depsZip, { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return state;
};

const fakeRunsCollection = () => {
  const docs = new Map();
  return {
    docs,
    replaceOne: async ({ _id }, doc) => void docs.set(_id, structuredClone(doc)),
    find: () => {
      const rows = [...docs.values()];
      const cur = { sort: () => cur, limit: () => cur, toArray: async () => rows };
      return cur;
    },
  };
};

const setup = (opts = {}) => {
  const gh = fakeGithub(opts);
  const mongo = { pipelineRuns: fakeRunsCollection() };
  const bus = new EventEmitter();
  const pushed = [];
  bus.on('pipeline.run', (d) => pushed.push(d));
  const poller = createGithubPoller({ repo: REPO, token: 'token' in opts ? opts.token : TOKEN, mongo, bus, log: silentLog, fetchImpl: gh.fetch, apiBase: API });
  return { gh, mongo, bus, pushed, poller };
};

test('stores a blocked run with redacted findings and pushes pipeline.run', async () => {
  const { mongo, pushed, poller } = setup();
  await poller.pollOnce();

  const doc = mongo.pipelineRuns.docs.get(7);
  assert.equal(doc.status, 'blocked');
  assert.equal(doc.reason, 'secret');
  assert.equal(doc.findingsState, 'loaded');
  assert.deepEqual(
    doc.findings.map((f) => [f.ruleId, f.file, f.line, f.redacted]),
    [['aws-access-token', 'backend/src/config/storage.js', 8, 'AKIA••••••••']],
  );
  const stored = JSON.stringify(doc);
  assert.ok(!stored.includes(FAKE_KEY.slice(4)), 'no part of the key past its prefix is stored');
  assert.ok(!stored.includes('dev@example.com'));
  assert.equal(pushed.length, 1);
  assert.equal(poller.getSync().ok, true);
});

test('the token goes to the API only, never to the artifact blob host', async () => {
  const { gh, poller } = setup();
  await poller.pollOnce();
  const blob = gh.requests.filter((r) => r.url === BLOB);
  assert.equal(blob.length, 1);
  assert.equal(blob[0].headers.Authorization, undefined);
  const api = gh.requests.filter((r) => r.url.startsWith(API));
  assert.ok(api.every((r) => r.headers.Authorization === `Bearer ${TOKEN}`));
  assert.equal(gh.requests.find((r) => r.url.endsWith('/artifacts/1/zip')).redirect, 'manual');
});

test('an unchanged run list (304) causes no refetch and no push', async () => {
  const { gh, pushed, poller } = setup();
  await poller.pollOnce();
  const before = gh.requests.length;
  await poller.pollOnce();
  assert.equal(gh.requests.length, before + 1); // just the conditional list request
  assert.equal(pushed.length, 1);
});

test('keeps re-checking a finished run while GitHub still lists a job as running', async () => {
  const { gh, mongo, pushed, poller } = setup({
    runs: [run({ conclusion: 'success' })],
    jobs: [job('secrets', null, 'in_progress'), job('build', 'success')],
  });
  gh.blob = makeZip({ 'secrets.json': '[]' });
  await poller.pollOnce();
  assert.equal(mongo.pipelineRuns.docs.get(7).settled, false);

  gh.jobs = [job('secrets', 'success'), job('build', 'success')];
  await poller.pollOnce();
  const doc = mongo.pipelineRuns.docs.get(7);
  assert.equal(doc.settled, true);
  assert.equal(doc.status, 'passed');
  assert.deepEqual(pushed.map((d) => d.jobs[0].status), ['running', 'passed']);
});

test('without a token: pass/fail only, slower polling, no artifact requests', async () => {
  const { gh, mongo, poller } = setup({ token: null });
  await poller.pollOnce();
  const doc = mongo.pipelineRuns.docs.get(7);
  assert.equal(doc.findingsState, 'token_required');
  assert.equal(doc.status, 'blocked'); // from the failed secrets job
  assert.equal(doc.reason, 'secret');
  assert.ok(!gh.requests.some((r) => r.url.includes('/artifacts')));
  assert.ok(gh.requests.every((r) => !('Authorization' in r.headers)));
  assert.equal(poller.getSync().pollMs, 120_000);
  assert.equal(poller.getSync().tokenConfigured, false);
});

test('GitHub down: sync reports it, stored runs stay, a pipeline.sync event is emitted', async () => {
  const { gh, mongo, bus, poller } = setup();
  const syncs = [];
  bus.on('pipeline.sync', (s) => syncs.push(s));
  await poller.pollOnce();
  gh.down = true;
  await poller.pollOnce();
  assert.equal(poller.getSync().ok, false);
  assert.equal(poller.getSync().error, 'unreachable');
  assert.ok(poller.getSync().lastSuccessAt instanceof Date);
  assert.equal(mongo.pipelineRuns.docs.size, 1);
  assert.deepEqual(syncs.map((s) => s.ok), [true, false]);
});

test('rate limited: reported as rate_limited', async () => {
  const { gh, poller } = setup();
  gh.rateLimited = true;
  await poller.pollOnce();
  assert.equal(poller.getSync().error, 'rate_limited');
});

test('a broken artifact leaves the run readable, with findings marked unavailable', async () => {
  const { gh, mongo, poller } = setup();
  gh.blob = Buffer.from('not a zip archive at all..............');
  await poller.pollOnce();
  const doc = mongo.pipelineRuns.docs.get(7);
  assert.equal(doc.findingsState, 'unavailable');
  assert.equal(doc.status, 'blocked'); // judged by the failed secrets job until the report can be read
  assert.equal(doc.findings.length, 0);
  gh.blob = secretsZip; // retried on the next poll
  await poller.pollOnce();
  const retried = mongo.pipelineRuns.docs.get(7);
  assert.equal(retried.findingsState, 'loaded');
  assert.equal(retried.findings[0].redacted, 'AKIA••••••••');
});

test('a redirect to a non-https location is refused', async () => {
  const { gh, mongo } = setup();
  const original = gh.fetch;
  const poller = createGithubPoller({
    repo: REPO,
    token: TOKEN,
    mongo,
    bus: new EventEmitter(),
    log: silentLog,
    apiBase: API,
    fetchImpl: async (url, init) =>
      url.endsWith('/artifacts/1/zip') ? new Response(null, { status: 302, headers: { location: 'http://plain.example/x' } }) : original(url, init),
  });
  await poller.pollOnce();
  assert.equal(mongo.pipelineRuns.docs.get(7).findingsState, 'unavailable');
  assert.ok(!gh.requests.some((r) => r.url.startsWith('http://plain.example')));
});

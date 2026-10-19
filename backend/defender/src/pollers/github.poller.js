// GitHub Actions poller (ARCH §4.4, BRIEF D6): every GITHUB_POLL_MS it reads
// the latest runs of the kairo-shield workflow, fetches jobs for runs that are
// new or changed, and once a run finishes downloads its report artifacts and
// parses them in memory. Each run is upserted into `pipeline_runs` and pushed
// to the console as `pipeline.run`.
//
// Read-only: GET requests only, with a fine-grained token (Actions: read).
// The token is sent to api.github.com and nowhere else: artifact downloads
// redirect to blob storage, and that request goes out without it. The token
// and request headers are never logged. Without a token the poller still
// shows pass/fail (GitHub's anonymous limit is 60 requests an hour, so it
// polls every 2 minutes) but cannot download the reports.
//
// GitHub unreachable: the stored runs stay on screen with the last sync time
// (ARCH §12); nothing else in the Defender is affected.

import { readZip } from '../utils/readZip.js';
import { reportParserFor, runFingerprint, toRunDoc } from '../services/pipeline.service.js';

const API = 'https://api.github.com';
const ANON_POLL_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ARTIFACT_BYTES = 1_000_000;
const MAX_SETTLE_ATTEMPTS = 8; // job list lag: re-check a finished run this many times
const MAX_FINDINGS_ATTEMPTS = 3;

export class GithubError extends Error {
  constructor(code, status, resetAt = null) {
    super(`github ${code}${status ? ` (${status})` : ''}`);
    this.code = code;
    this.status = status;
    this.resetAt = resetAt;
  }
}

const classify = (res) => {
  const remaining = res.headers.get('x-ratelimit-remaining');
  if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.headers.get('retry-after'))) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || null;
    return new GithubError('rate_limited', res.status, reset);
  }
  if (res.status === 401) return new GithubError('token_invalid', 401);
  if (res.status === 404) return new GithubError('not_found', 404); // repo/workflow missing or not visible to the token
  return new GithubError(`http_${res.status}`, res.status);
};

export const createGithubPoller = ({
  repo,
  token = null,
  pollMs = 15_000,
  workflow = 'kairo-shield.yml',
  mongo,
  bus,
  log,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  apiBase = API,
}) => {
  const interval = token ? pollMs : Math.max(pollMs, ANON_POLL_MS);
  const known = new Map(); // runId → { ghUpdatedAt, fingerprint, settled, findings, findingsState, settleAttempts, findingsAttempts }
  let etag = null;
  let lastRuns = [];
  let timer = null;
  let stopped = false;
  let backoffUntil = 0;

  const sync = {
    repo,
    workflow,
    tokenConfigured: Boolean(token),
    pollMs: interval,
    ok: null, // null until the first poll finishes
    error: null,
    lastSuccessAt: null,
    lastAttemptAt: null,
  };

  const headers = (extra = {}) => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kairo-shield-defender',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });

  const getJson = async (path, { ifNoneMatch } = {}) => {
    const res = await fetchImpl(`${apiBase}${path}`, {
      headers: headers(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw classify(res);
    return { json: await res.json(), etag: res.headers.get('etag') };
  };

  const readCapped = async (res) => {
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_ARTIFACT_BYTES) throw new GithubError('artifact_too_large', res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ARTIFACT_BYTES) throw new GithubError('artifact_too_large', res.status);
    return buf;
  };

  /** Artifact zip: the API answers with a redirect to blob storage, which is fetched without the token. */
  const downloadArtifact = async (id) => {
    const res = await fetchImpl(`${apiBase}/repos/${repo}/actions/artifacts/${id}/zip`, {
      headers: headers(),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 200) return readCapped(res);
    if (![301, 302, 303, 307, 308].includes(res.status)) throw classify(res);
    const location = res.headers.get('location');
    if (!location || !location.startsWith('https://')) throw new GithubError('bad_redirect', res.status);
    const blob = await fetchImpl(location, {
      headers: { 'User-Agent': 'kairo-shield-defender' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!blob.ok) throw new GithubError(`blob_http_${blob.status}`, blob.status);
    return readCapped(blob);
  };

  /** → { findings, findingsState } from the run's kairo-* artifacts. */
  const loadFindings = async (runId) => {
    const { json } = await getJson(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=20`);
    const reports = (json.artifacts ?? []).filter((a) => reportParserFor(a.name));
    if (!reports.length) return { findings: [], findingsState: 'unavailable' };

    const findings = [];
    let complete = true;
    for (const a of reports) {
      if (a.expired || a.size_in_bytes > MAX_ARTIFACT_BYTES) {
        complete = false;
        continue;
      }
      try {
        const parse = reportParserFor(a.name);
        for (const entry of readZip(await downloadArtifact(a.id), { maxEntryBytes: MAX_ARTIFACT_BYTES })) {
          if (entry.name.endsWith('.json')) findings.push(...parse(JSON.parse(entry.data.toString('utf8'))));
        }
      } catch (err) {
        complete = false;
        log.warn({ msg: 'pipeline.artifact_failed', runId, artifact: a.name, error: err.code ?? 'parse_failed' });
      }
    }
    return { findings, findingsState: complete ? 'loaded' : 'unavailable' };
  };

  const needsRefresh = (run) => {
    const k = known.get(run.id);
    if (!k || k.ghUpdatedAt !== run.updated_at) return true;
    if (!k.settled && k.settleAttempts < MAX_SETTLE_ATTEMPTS) return true;
    return Boolean(token) && run.status === 'completed' && k.findingsState !== 'loaded' && k.findingsAttempts < MAX_FINDINGS_ATTEMPTS;
  };

  const refreshRun = async (run) => {
    const prev = known.get(run.id);
    const changed = !prev || prev.ghUpdatedAt !== run.updated_at;
    const { json } = await getJson(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`);

    let findings = prev?.findings ?? [];
    let findingsState = prev?.findingsState ?? 'pending';
    let findingsAttempts = changed ? 0 : (prev?.findingsAttempts ?? 0);
    if (run.status !== 'completed') {
      findingsState = 'pending';
    } else if (!token) {
      findingsState = 'token_required';
    } else if (findingsState !== 'loaded' || changed) {
      ({ findings, findingsState } = await loadFindings(run.id));
      findingsAttempts += 1;
    }

    const doc = toRunDoc({ repo, run, jobs: json.jobs ?? [], findings, findingsState, now: now() });
    await mongo.pipelineRuns.replaceOne({ _id: doc._id }, doc, { upsert: true });

    const fingerprint = runFingerprint(doc);
    known.set(run.id, {
      ghUpdatedAt: run.updated_at,
      fingerprint,
      settled: doc.settled,
      findings,
      findingsState,
      settleAttempts: changed ? 1 : (prev?.settleAttempts ?? 0) + 1,
      findingsAttempts,
    });
    if (fingerprint !== prev?.fingerprint) {
      log.info({ msg: 'pipeline.run', runId: doc._id, branch: doc.branch, event: doc.event, status: doc.status, reason: doc.reason, findings: findings.length });
      bus.emit('pipeline.run', doc);
    }
  };

  const setSync = (patch) => {
    const before = `${sync.ok}|${sync.error}`;
    Object.assign(sync, patch);
    if (`${sync.ok}|${sync.error}` !== before) bus.emit('pipeline.sync', { ...sync });
  };

  const pollOnce = async () => {
    sync.lastAttemptAt = new Date(now());
    try {
      const list = await getJson(`/repos/${repo}/actions/workflows/${workflow}/runs?per_page=10`, { ifNoneMatch: etag });
      if (!list.notModified) {
        etag = list.etag;
        lastRuns = list.json.workflow_runs ?? [];
      }
      for (const run of lastRuns) {
        if (needsRefresh(run)) await refreshRun(run);
      }
      setSync({ ok: true, error: null, lastSuccessAt: new Date(now()) });
    } catch (err) {
      const code = err instanceof GithubError ? err.code : err.name === 'TimeoutError' ? 'timeout' : 'unreachable';
      if (code === 'rate_limited' && err.resetAt) backoffUntil = err.resetAt;
      if (sync.error !== code) log.warn({ msg: 'pipeline.poll_failed', error: code, status: err.status ?? null });
      setSync({ ok: false, error: code });
    }
  };

  /** Remembers what's already stored, so a restart doesn't refetch settled runs. */
  const hydrate = async () => {
    const docs = await mongo.pipelineRuns
      .find({}, { projection: { ghUpdatedAt: 1, settled: 1, findings: 1, findingsState: 1, status: 1, reason: 1, jobs: 1 } })
      .sort({ startedAt: -1 })
      .limit(50)
      .toArray();
    for (const d of docs) {
      known.set(d._id, {
        ghUpdatedAt: d.ghUpdatedAt,
        fingerprint: runFingerprint({ ...d, findings: d.findings ?? [] }),
        settled: d.settled,
        findings: d.findings ?? [],
        findingsState: d.findingsState,
        settleAttempts: d.settled ? 0 : MAX_SETTLE_ATTEMPTS - 1,
        findingsAttempts: 0,
      });
    }
  };

  const loop = async () => {
    if (stopped) return;
    if (now() >= backoffUntil) await pollOnce();
    if (stopped) return;
    const wait = Math.max(interval, backoffUntil - now());
    timer = setTimeout(loop, wait);
    timer.unref?.();
  };

  return {
    sync,
    getSync: () => ({ ...sync }),
    pollOnce,
    async start() {
      await hydrate().catch((err) => log.warn({ msg: 'pipeline.hydrate_failed', error: err.message }));
      log.info({ msg: 'pipeline.poller_started', repo, workflow, pollMs: interval, tokenConfigured: Boolean(token) });
      loop();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
};

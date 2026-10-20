// CypherFy health probe (ARCH §4.5, §11.4; PHASES Oct 22 #3): GET
// /api/v1/health every R4.probeEveryMs with a probeTimeoutMs timeout. A probe
// is OK only for HTTP 200 with {"status":"ok"}; a 5xx, a timeout, no answer
// or {"status":"degraded"} is a failure. Each result goes to the deploy
// service (R4) and is kept for system.status, which also drives the console's
// "No events from CypherFy" band (BRIEF D5). The URL comes from the
// environment only; the response body is read for `status` and nothing else.

const MAX_BODY_BYTES = 4096;

export const probeOnce = async ({ url, timeoutMs, fetchImpl = fetch, now = Date.now }) => {
  const at = now();
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    let status = null;
    try {
      const text = (await res.text()).slice(0, MAX_BODY_BYTES);
      const s = JSON.parse(text)?.status;
      status = typeof s === 'string' && /^[a-z_]{1,20}$/.test(s) ? s : null;
    } catch {
      /* not JSON: judged by the HTTP status alone */
    }
    return { at, ok: res.status === 200 && status === 'ok', httpStatus: res.status, status, error: null, ms: now() - at };
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { at, ok: false, httpStatus: null, status: null, error: timeout ? 'timeout' : 'unreachable', ms: now() - at };
  }
};

export const createHealthPoller = ({ url, getConfig, onProbe, log, fetchImpl = fetch, now = Date.now }) => {
  let timer = null;
  let stopped = false;
  let last = null;
  let failuresInARow = 0;

  const tick = async () => {
    const cfg = getConfig().rules.R4;
    const result = await probeOnce({ url, timeoutMs: cfg.probeTimeoutMs, fetchImpl, now });
    failuresInARow = result.ok ? 0 : failuresInARow + 1;
    if (last?.ok !== result.ok) log?.[result.ok ? 'info' : 'warn']({ msg: result.ok ? 'cypherfy.healthy' : 'cypherfy.unhealthy', httpStatus: result.httpStatus, status: result.status, error: result.error });
    last = { ...result, failuresInARow };
    try {
      await onProbe?.(result);
    } catch (err) {
      log?.error({ msg: 'health.on_probe_failed', error: err?.message?.slice(0, 200) });
    }
    if (!stopped) {
      timer = setTimeout(tick, cfg.probeEveryMs);
      timer.unref?.();
    }
  };

  return {
    start: () => {
      stopped = false;
      return tick();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
    tick,
    /** Latest probe for system.status: { at, ok, httpStatus, status, error, ms, failuresInARow } or null. */
    last: () => last,
  };
};

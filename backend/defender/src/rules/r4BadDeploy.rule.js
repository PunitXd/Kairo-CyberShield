// R4 — bad deploy (PRD F4/F11, ARCH §4.5, §11.4). Probe-driven, not
// event-driven: the health poller probes CypherFy's /api/v1/health every
// probeEveryMs and hands each result to the deploy service, which asks this
// rule whether the watched deployment has failed. Failures inside the grace
// window after "started" don't count (a restart is expected to be briefly
// unhealthy). Action: roll back to the last deployment marked healthy, at most
// once per budget window (rollback.service.js). Severity high; a rollback that
// can't happen (budget used, no healthy target, deployer silent) is critical.

import { describeWindow } from '../utils/describeWindow.js';

export const r4BadDeploy = {
  id: 'R4',
  name: 'Bad deploy',
  family: 'deploy',
  version: 1,
  on: [], // no stream events: see evaluateProbe
  subject: () => null,
  measure: () => ({ value: 0 }),
  evaluate: () => null,

  /**
   * @param {{ tag, prevTag, startedAt, failuresInARow, lastProbe }} watch  the watched deployment
   * @returns {object|null} a decision, like the event rules return
   */
  evaluateProbe(watch, cfg, now) {
    if (!watch.startedAt || now - watch.startedAt < cfg.graceMs) return null;
    if (watch.failuresInARow < cfg.failuresInARow) return null;
    const probe = watch.lastProbe ?? {};
    const what = probe.httpStatus ? `HTTP ${probe.httpStatus}${probe.status ? ` (${probe.status})` : ''}` : (probe.error ?? 'no answer');
    return {
      severity: 'high',
      summary: `cypherfy-backend ${watch.tag.slice(0, 7)} failed ${watch.failuresInARow} health probes in a row after the ${describeWindow(cfg.graceMs)} grace (${what})`,
      actions: [{ type: 'rollback', scope: 'deploy', params: { toTag: watch.prevTag } }],
      evidence: {
        observed: watch.failuresInARow,
        threshold: cfg.failuresInARow,
        windowMs: cfg.failuresInARow * cfg.probeEveryMs,
        graceMs: cfg.graceMs,
        tag: watch.tag,
        prevTag: watch.prevTag ?? null,
        lastHttpStatus: probe.httpStatus ?? null,
      },
      fieldsUsed: ['health.httpStatus', 'health.status', 'deploy.tag', 'deploy.startedAt'],
    };
  },
};

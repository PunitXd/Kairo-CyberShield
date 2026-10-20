// Words and numbers for the Deployments screen (BRIEF §6 S7, Flow D; PHASES
// Oct 22 #4). Plain functions so they can be unit-tested with node --test.

import { formatRunDuration } from './formatTime.js';

const ms = (d) => (d === null || d === undefined ? null : typeof d === 'number' ? d : Date.parse(d));
const short = (tag) => (tag ? String(tag).slice(0, 7) : '—');

/** The state pill for one deployment: { state, label } with state a CSS-safe word. */
export const deploymentState = (d) => {
  switch (d.status) {
    case 'deploying':
      return { state: 'deploying', label: d.startedAt ? 'Deploying' : 'Waiting for the deployer' };
    case 'healthy':
      return { state: 'healthy', label: 'Healthy' };
    case 'unhealthy':
      return { state: 'unhealthy', label: 'Unhealthy' };
    case 'rolled_back':
      return { state: 'rolled_back', label: `Rolled back → ${short(d.rolledBackTo)}` };
    case 'failed':
      return { state: 'failed', label: 'Failed to start' };
    default:
      return { state: 'unknown', label: d.status ?? '—' };
  }
};

/** Grace bar while a deploy is starting: { pct, leftMs } or null when not in grace. */
export const graceProgress = (d, graceMs, now) => {
  const started = ms(d.startedAt);
  if (d.status !== 'deploying' || !started || !graceMs) return null;
  const elapsed = Math.max(0, now - started);
  if (elapsed >= graceMs) return null;
  return { pct: Math.round((elapsed / graceMs) * 100), leftMs: graceMs - elapsed };
};

/**
 * The outcome column: "healthy in 1 min 2 s" for a good deploy, "recovered in
 * 18 s" (unhealthy → previous version serving) after a rollback.
 */
export const outcomeText = (d) => {
  if (d.status === 'healthy' && d.healthyAt && d.startedAt) return `healthy in ${formatRunDuration(ms(d.healthyAt) - ms(d.startedAt))}`;
  if (d.status === 'rolled_back' && d.rolledBackAt) {
    const from = ms(d.unhealthyAt) ?? ms(d.startedAt);
    return from ? `recovered in ${formatRunDuration(ms(d.rolledBackAt) - from)}` : 'recovered';
  }
  if (d.status === 'failed') return d.error ?? 'did not start';
  if (d.status === 'unhealthy') return d.rollbackFailedAt ? 'rollback did not recover it' : 'not rolled back';
  return '';
};

/** "29:12" for the budget countdown. */
const mmss = (leftMs) => {
  const s = Math.max(0, Math.ceil(leftMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The rollback budget banner (BRIEF §6 S7, Flow D step 3):
 *   frozen    → critical, with the reason
 *   used      → warning, "next allowed in 29:12"
 *   available → info, "1 automatic rollback per 30 min · available"
 */
export const budgetBanner = (rollback, budgetMs, now) => {
  const per = budgetMs ? formatRunDuration(budgetMs).replace(' 0 s', '') : '30 min';
  if (rollback?.frozen) {
    return { tone: 'critical', text: `Rollback paused${rollback.frozenReason ? ` (${rollback.frozenReason})` : ''}. Manual action needed: fix or roll back by hand, then clear the freeze.` };
  }
  if (rollback?.budgetAvailableAt && rollback.budgetAvailableAt > now) {
    return { tone: 'warning', text: `Automatic rollback used · next allowed in ${mmss(rollback.budgetAvailableAt - now)}` };
  }
  return { tone: 'info', text: `1 automatic rollback per ${per} · available` };
};

/** Health from the latest probe, in words. */
export const healthText = (probe) => {
  if (!probe) return 'Not probed yet';
  if (probe.ok) return 'Healthy';
  if (probe.httpStatus) return `Unhealthy · HTTP ${probe.httpStatus}${probe.status ? ` (${probe.status})` : ''}`;
  return `Unhealthy · ${probe.error ?? 'no answer'}`;
};

/** Can the operator roll this one back by hand? Only to a previous version, and not while one is running. */
export const canRollBack = (d, list, recovering) =>
  Boolean(d.prevTag) && !recovering && ['unhealthy', 'deploying', 'healthy'].includes(d.status) && list[0]?._id === d._id;

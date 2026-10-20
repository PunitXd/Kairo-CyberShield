// S7 Deployments (BRIEF §6, Flow D; PHASES Oct 22 #4): current version card
// → rollback budget banner (or the critical frozen state) → deployment list.
// Each row: version, state, started, time to healthy or to recovery, the last
// probes, a grace bar while it starts, and its R4 incident. Rolling back by
// hand and clearing the freeze both change what serves users, so both ask
// first in a ConfirmPopover.

import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';

import ConfirmPopover from '../../components/ConfirmPopover.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { useConsole } from '../../hooks/useConsole.js';
import { useDeployments } from '../../hooks/useDeployments.js';
import { useNow } from '../../hooks/useNow.js';
import { rollbackDeployment, unfreezeRollback } from '../../services/api.service.js';
import { showToast } from '../../services/toast.service.js';
import { budgetBanner, canRollBack, deploymentState, graceProgress, healthText, outcomeText } from '../../utils/deployState.js';
import { formatAgo, formatClock } from '../../utils/formatTime.js';
import { actionBlockedReason, isStale } from '../../utils/systemState.js';

const short = (tag) => (tag ? String(tag).slice(0, 7) : '—');

/** A button that confirms first; `run` returns a promise. */
function ConfirmButton({ id, label, title, confirmLabel, tone = 'danger', blockedReason, run, children }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => ref.current?.focus());
  }, []);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await run();
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="killswitch">
      <button
        type="button"
        ref={ref}
        className="btn btn--secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={Boolean(blockedReason)}
        title={blockedReason ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <ConfirmPopover id={id} title={title} confirmLabel={confirmLabel} tone={tone} busy={busy} error={error} onConfirm={confirm} onCancel={close}>
          {children}
        </ConfirmPopover>
      )}
    </span>
  );
}

function ProbeStrip({ probes }) {
  const last = (probes ?? []).slice(-10);
  if (!last.length) return <span className="probe-strip probe-strip--empty">no probes yet</span>;
  const failed = last.filter((p) => !p.ok).length;
  return (
    <span className="probe-strip" role="img" aria-label={`Last ${last.length} health probes: ${last.length - failed} OK, ${failed} failed`}>
      {last.map((p, i) => (
        <span key={i} className={`probe-strip__dot${p.ok ? ' probe-strip__dot--ok' : ''}`} title={`${formatClock(Date.parse(p.at))} · ${p.ok ? 'OK' : p.httpStatus ? `HTTP ${p.httpStatus}` : p.error}`} />
      ))}
    </span>
  );
}

export default function Deployments() {
  const { connection, connectionSince, status } = useConsole();
  const stale = isStale(connection);
  const blockedReason = actionBlockedReason(connection, status);
  const now = useNow(stale);
  const rollbackKey = JSON.stringify(status?.rollback ?? null);
  const { data, error, loaded, reload } = useDeployments(connection, rollbackKey);

  const items = data?.items ?? [];
  const cfg = data?.config ?? null;
  const banner = data ? budgetBanner(data.rollback, cfg?.budgetMs, now) : null;
  const current = data?.current ?? null;
  const serving = current ? items.find((d) => d.tag === current.tag && d.status === 'healthy') ?? items.find((d) => d._id === current.deploymentId) : null;
  // After a rollback the old version serves again, but only since the rollback (Flow D step 3).
  const restoredBy = items[0]?.status === 'rolled_back' ? items[0] : null;

  const rollBack = (d) => async () => {
    const r = await rollbackDeployment(d._id);
    showToast({ message: `Rolling back to ${short(r.toTag)}…` });
    reload();
  };
  const unfreeze = async () => {
    await unfreezeRollback();
    showToast({ message: 'Rollback automation resumed' });
    reload();
  };

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Deployments
      </h1>

      {error && !loaded ? (
        <div className="panel">
          <EmptyState hint={error.message}>Could not load deployments.</EmptyState>
        </div>
      ) : !loaded ? (
        <div className="panel">
          <EmptyState>Waiting for the Defender…</EmptyState>
        </div>
      ) : (
        <>
          <div className="deploy-top">
            <section className="panel deploy-current" aria-labelledby="current-title">
              <h2 id="current-title" className="panel__title">
                Serving now
                {stale && <span className="stale-stamp">as of {formatClock(connectionSince)}</span>}
              </h2>
              {current ? (
                <>
                  <p className="deploy-current__tag mono">cypherfy-backend:{short(current.tag)}</p>
                  <p className="deploy-current__meta">
                    {restoredBy?.rolledBackAt
                      ? `Serving again since ${formatClock(Date.parse(restoredBy.rolledBackAt))}: rolled back from ${short(restoredBy.tag)}`
                      : serving?.healthyAt
                        ? `Healthy since ${formatClock(Date.parse(serving.healthyAt))} (${formatAgo(Date.parse(serving.healthyAt), now)})`
                        : deploymentState({ status: current.status, startedAt: true }).label}
                  </p>
                </>
              ) : (
                <EmptyState hint="Run bash scripts/deploy.sh <sha> to record the first deployment.">No deployments yet.</EmptyState>
              )}
              <p className={`deploy-current__health${data.health && !data.health.ok ? ' deploy-current__health--bad' : ''}`}>
                Health: {healthText(data.health)}
                {data.health?.at ? ` · checked ${formatClock(data.health.at)}` : ''}
              </p>
            </section>

            <section className={`panel deploy-budget deploy-budget--${banner.tone}`} aria-labelledby="budget-title" role={banner.tone === 'critical' ? 'alert' : undefined}>
              <h2 id="budget-title" className="panel__title">
                Automatic rollback {cfg?.mode && cfg.mode !== 'enforce' ? <span className="rules__version">R4 in {cfg.mode}</span> : null}
              </h2>
              <p className="deploy-budget__text">{banner.text}</p>
              <p className="deploy-budget__hint">
                After a deploy, {cfg ? `${Math.round(cfg.graceMs / 1000)} s of grace, then ${cfg.failuresInARow} failed health probes in a row` : 'a grace window, then failed health probes'} roll it back to the last healthy version. Never to a version that wasn't healthy, never twice in a window.
              </p>
              {data.rollback?.frozen && (
                <ConfirmButton
                  id="unfreeze"
                  label="Clear the freeze"
                  title="Let Kairo roll back automatically again?"
                  confirmLabel="Clear the freeze"
                  tone="primary"
                  blockedReason={blockedReason}
                  run={unfreeze}
                >
                  <p>Do this once a healthy version is serving. The rollback budget still applies: if it was used, the next automatic rollback waits until the window ends.</p>
                </ConfirmButton>
              )}
            </section>
          </div>

          <section className="panel" aria-labelledby="list-title">
            <h2 id="list-title" className="panel__title">
              Deployments
            </h2>
            {items.length === 0 ? (
              <EmptyState hint="bash scripts/deploy.sh <sha> builds an image from that commit and deploys it.">No deployments recorded.</EmptyState>
            ) : (
              <div className="feed-scroll">
                <table className="feed deploys">
                  <thead>
                    <tr>
                      <th scope="col">Version</th>
                      <th scope="col">State</th>
                      <th scope="col">Started</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Last probes</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => {
                      const st = deploymentState(d);
                      const grace = graceProgress(d, cfg?.graceMs, now);
                      const started = d.startedAt ?? d.requestedAt;
                      return (
                        <tr key={d._id} className={d._id === data.watching || d._id === data.recovering ? 'row--latest' : undefined}>
                          <td>
                            <span className="mono">{short(d.tag)}</span>
                            {d.prevTag && <span className="deploys__prev mono">from {short(d.prevTag)}</span>}
                          </td>
                          <td>
                            <span className={`deploy-pill deploy-pill--${st.state}`}>{st.label}</span>
                            {serving?._id === d._id && <span className={`deploys__serving${d.status === 'healthy' ? '' : ' deploys__serving--bad'}`}>Serving</span>}
                            {grace && (
                              <span className="grace" role="progressbar" aria-valuenow={grace.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Grace window, ${Math.ceil(grace.leftMs / 1000)} s left`}>
                                <span className="grace__bar" style={{ width: `${grace.pct}%` }} />
                                <span className="grace__label">grace · {Math.ceil(grace.leftMs / 1000)} s left</span>
                              </span>
                            )}
                          </td>
                          <td className="row__time mono">{started ? formatClock(Date.parse(started)) : '—'}</td>
                          <td>
                            {outcomeText(d)}
                            {d.incidentId && (
                              <>
                                {' '}
                                <Link to={`/incidents?open=${d.incidentId}`} className="deploys__incident">
                                  incident
                                </Link>
                              </>
                            )}
                          </td>
                          <td>
                            <ProbeStrip probes={d.probeLog} />
                          </td>
                          <td>
                            {canRollBack(d, items, data.recovering) && (
                              <ConfirmButton
                                id={`rollback-${d._id}`}
                                label="Roll back"
                                title={`Roll back to ${short(d.prevTag)}?`}
                                confirmLabel={`Roll back to ${short(d.prevTag)}`}
                                blockedReason={blockedReason}
                                run={rollBack(d)}
                              >
                                <p>
                                  cypherfy-backend restarts on {short(d.prevTag)}, the last version marked healthy. Users see a short reconnect. This does not use the
                                  automatic rollback budget.
                                </p>
                              </ConfirmButton>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

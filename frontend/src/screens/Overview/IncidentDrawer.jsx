// S2 Incident detail (BRIEF §6): headline sentence → action bar → timeline →
// evidence → Fields received. Opened at /incidents/:id over the Overview,
// which stays mounted and live underneath. Unblock is the primary action
// while a block or throttle is active; Mark false positive (optionally with a
// 24 h allowlist) sits next to it (PHASES Oct 21 #4). Extend is cut. Esc
// returns focus to the row that opened it.
//
// Two hosts: the Overview renders it at /incidents/:id through <Outlet> (id
// from the route, data from the outlet context); the Incidents screen renders
// it directly with `id`, `context` and `onClose` props (?open=<id>).

import { useCallback } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';

import Drawer from '../../components/Drawer.jsx';
import SeverityGlyph from '../../components/SeverityGlyph.jsx';
import ActionPill from '../../components/ActionPill.jsx';
import Countdown from '../../components/Countdown.jsx';
import Timeline from '../../components/Timeline.jsx';
import FieldChips from '../../components/FieldChips.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import FalsePositiveControl from '../../components/FalsePositiveControl.jsx';
import AttemptsChart from '../../components/AttemptsChart.jsx';
import { useIncidentSeries } from '../../hooks/useIncidentSeries.js';
import { useAllowlist } from '../../hooks/useAllowlist.js';
import { useConsole } from '../../hooks/useConsole.js';
import { useIncidentDetail } from '../../hooks/useIncidentDetail.js';
import { useUnblock } from '../../hooks/useUnblock.js';
import { deriveActionState, SCOPE_LABEL } from '../../utils/incidentState.js';
import { formatHash } from '../../utils/formatHash.js';
import { describeWindow } from '../../utils/formatDuration.js';
import { formatClock } from '../../utils/formatTime.js';

const VERB = { blocked: 'Blocked', throttled: 'Throttled' };

// Socket scope reads as what happened to connections, not "from sockets".
const SOCKET_HEADLINE = {
  blocked: (who) => `Blocked new connections from ${who}`,
  throttled: (who) => `Slowed down a connection from ${who}`,
  disconnected: (who) => `Disconnected a connection from ${who}`,
};

const headline = (incident, action) => {
  if (incident.family === 'deploy') return incident.summary;
  const who = formatHash('ip', incident.subject);
  const why = incident.summary;
  if (action.scope === 'socket' && SOCKET_HEADLINE[action.state]) return `${SOCKET_HEADLINE[action.state](who)} after ${why}`;
  if (VERB[action.state]) return `${VERB[action.state]} ${who} from ${SCOPE_LABEL[action.scope] ?? action.scope} after ${why}`;
  if (action.heldBack) return `${VERB[action.heldBack]} ${who} from ${SCOPE_LABEL[action.scope] ?? action.scope}, held back by the kill switch, after ${why}`;
  if (action.state === 'shadow') return `Would have acted on ${who} after ${why}`;
  return `${who}: ${why} (${action.reason === 'manually' ? 'unblocked by the operator' : 'expired'})`;
};

function UnblockButton({ scope, subject, blockedReason, onUnblocked }) {
  const { state, error, unblock, label } = useUnblock({ scope, subject, onUnblocked });
  const busy = state === 'unblocking';
  return (
    <>
      <button
        type="button"
        className="btn btn--primary"
        onClick={unblock}
        disabled={busy || Boolean(blockedReason)}
        aria-busy={busy || undefined}
        aria-label={`Unblock ${label}`}
        title={blockedReason ?? undefined}
      >
        {busy ? 'Unblocking…' : state === 'failed' ? 'Retry unblock' : 'Unblock'}
      </button>
      {state === 'failed' && (
        <p className="block-card__error" role="alert">
          Unblock failed: {error}
        </p>
      )}
    </>
  );
}

export default function IncidentDrawer({ id: idProp, context, onClose } = {}) {
  const params = useParams();
  const outlet = useOutletContext();
  const id = idProp ?? params.id;
  const navigate = useNavigate();
  const { incidents, blocks, now, blockedReason, killSwitch, removeBlocksFor } = context ?? outlet;
  const { detail, error, loading, reload } = useIncidentDetail(id);
  const { connection } = useConsole();
  const allowlist = useAllowlist(connection);
  const feedIncident = detail?.incident ?? incidents.find((i) => i._id === id);
  const { series, error: seriesError } = useIncidentSeries(feedIncident?.family === 'deploy' ? null : id, feedIncident?.lastSeenAt);

  // Header renders instantly from the feed row; the detail fills in the rest.
  const incident = detail?.incident ?? incidents.find((i) => i._id === id);

  const close = useCallback(() => {
    if (onClose) onClose();
    else navigate('/');
    requestAnimationFrame(() => document.querySelector(`tr[data-incident-id="${id}"]`)?.focus());
  }, [navigate, id, onClose]);

  if (!incident) {
    return (
      <Drawer title="Incident" onClose={close}>
        {loading ? <EmptyState>Loading…</EmptyState> : <EmptyState hint={error?.message}>Could not load this incident.</EmptyState>}
      </Drawer>
    );
  }

  const action = deriveActionState(incident, blocks, now, { killSwitch });
  const allowlisted = allowlist.items.find((e) => e.subject === incident.subject && e.expiresAt > now) ?? null;
  // Still unblockable while the kill switch holds it back: the key exists.
  // Unblock needs a Redis key; a socket slow-down or disconnect has none.
  const active = ((action.state === 'blocked' || action.state === 'throttled') && !action.keyless) || Boolean(action.heldBack);
  const ev = incident.evidence ?? {};
  const distinctNoun = incident.family === 'room' ? 'distinct codes' : 'distinct accounts';

  return (
    <Drawer title={headline(incident, action)} onClose={close}>
      <div className="drawer__meta">
        <SeverityGlyph level={incident.severity} />
        <span className="mono drawer__rule">
          {incident.ruleId}
          {incident.ruleVersion ? ` v${incident.ruleVersion}` : ''}
        </span>
        <ActionPill state={action.state} scope={action.scope} reason={action.reason} />
        <Countdown expiresAt={action.expiresAt} now={now} />
        {incident.falsePositive && <span className="tag tag--fp">False positive</span>}
        {allowlisted && <span className="tag tag--allow">Allowlisted until {formatClock(allowlisted.expiresAt)}</span>}
      </div>

      <div className="drawer__actions">
        {active && (
          <UnblockButton scope={action.scope} subject={incident.subject} blockedReason={blockedReason} onUnblocked={(b) => removeBlocksFor(b.scope, b.subject)} />
        )}
        <FalsePositiveControl incident={incident} allowlisted={allowlisted} blockedReason={blockedReason} onDone={reload} />
      </div>

      <section className="drawer__section" aria-labelledby="timeline-title">
        <h3 id="timeline-title" className="drawer__section-title">
          Timeline
        </h3>
        {detail ? (
          <Timeline steps={detail.timeline} />
        ) : error ? (
          <EmptyState hint={error.message}>
            Could not load the timeline.{' '}
            <button type="button" className="btn btn--secondary" onClick={reload}>
              Retry
            </button>
          </EmptyState>
        ) : (
          <div className="skeleton skeleton--block" aria-label="Loading timeline" />
        )}
      </section>

      <section className="drawer__section" aria-labelledby="evidence-title">
        <h3 id="evidence-title" className="drawer__section-title">
          Evidence
        </h3>
        <p className="drawer__evidence">
          Observed <strong>{ev.observed ?? '—'}</strong> against a threshold of <strong>{ev.threshold ?? '—'}</strong>
          {ev.windowMs ? ` in ${describeWindow(ev.windowMs)}` : ''}
          {Number.isFinite(ev.distinct) ? ` · ${ev.distinct} ${distinctNoun}` : ''}
          {Number.isFinite(ev.softFirings) && ev.softFirings > 0 ? ` · soft step fired ${ev.softFirings}×` : ''}
        </p>
      </section>

      {incident.family !== 'deploy' && (
        <section className="drawer__section" aria-labelledby="attempts-title">
          <h3 id="attempts-title" className="drawer__section-title">
            Attempts over time
          </h3>
          {series?.available ? (
            <AttemptsChart series={series} actions={detail?.actions ?? []} />
          ) : series ? (
            <p className="empty-state__hint">
              {series.reason === 'no_series'
                ? 'No attempt history for this kind of incident.'
                : `Attempt history is kept for ${Math.round((series.retentionMs ?? 900_000) / 60_000)} min after the last event (and restarts with the Defender). The evidence below still holds.`}
            </p>
          ) : seriesError ? (
            <p className="empty-state__hint">Could not load the attempt history: {seriesError.message}</p>
          ) : (
            <div className="skeleton skeleton--block" aria-label="Loading attempt history" />
          )}
        </section>
      )}

      <section className="drawer__section" aria-labelledby="fields-title">
        <h3 id="fields-title" className="drawer__section-title">
          Fields received
        </h3>
        <FieldChips fields={incident.fieldsUsed} />
        <p className="empty-state__hint">Field names only. Kairo never receives message text, keys, raw room codes, raw IPs or emails.</p>
      </section>
    </Drawer>
  );
}

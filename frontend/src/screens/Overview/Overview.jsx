// S1 Overview (BRIEF §6): KPI strip → incident feed → active blocks rail.
// The feed explains, the rail is where you reverse. Event-rate sparklines are
// first on the cut list (PHASES §4) and not built. The incident drawer
// (/incidents/:id) renders through <Outlet>, so this screen stays mounted and
// live underneath it.

import { useState } from 'react';
import { Outlet, useMatch, useNavigate } from 'react-router';

import KpiTile from '../../components/KpiTile.jsx';
import IncidentRow from '../../components/IncidentRow.jsx';
import BlockCard from '../../components/BlockCard.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { useConsole } from '../../hooks/useConsole.js';
import { useNow } from '../../hooks/useNow.js';
import { useOverviewData } from '../../hooks/useOverviewData.js';
import { useFeedAnnouncer } from '../../hooks/useFeedAnnouncer.js';
import { deriveActionState } from '../../utils/incidentState.js';
import { formatLatency } from '../../utils/formatDuration.js';

const enforcingRules = (status) => (status?.rules ?? []).filter((r) => r.mode === 'enforce').map((r) => r.id);

export default function Overview() {
  const { connection, status } = useConsole();
  const stale = connection !== 'live';
  const now = useNow(stale);
  const { incidents, blocks, overview, loaded, error, dataAt, freshIds, removeBlocksFor } = useOverviewData(connection);

  const activeBlocks = blocks.filter((b) => b.expiresAt > now).sort((a, b) => a.expiresAt - b.expiresAt);
  const hardBlocks = activeBlocks.filter((b) => b.level === 'block');
  const throttles = activeBlocks.length - hardBlocks.length;
  const blockedSources = new Set(hardBlocks.map((b) => b.subject)).size;
  const announcement = useFeedAnnouncer(incidents, blockedSources);

  const navigate = useNavigate();
  const selectedId = useMatch('/incidents/:id')?.params.id ?? null;
  const [focusIndex, setFocusIndex] = useState(0);
  const openIncident = (id) => navigate(`/incidents/${id}`);

  // Feed keyboard (BRIEF §10): one tab stop, ↑/↓ or j/k move, Enter opens.
  const onFeedKey = (e) => {
    const rows = [...e.currentTarget.querySelectorAll('tr[data-incident-id]')];
    const i = rows.indexOf(document.activeElement);
    if (i === -1) return;
    const move = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    if (move) {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, i + move));
      setFocusIndex(next);
      rows[next].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openIncident(rows[i].dataset.incidentId);
    }
  };

  const tileState = (value) => (!loaded ? 'loading' : stale ? 'stale' : value === null || value === undefined ? 'empty' : 'live');
  const rules = enforcingRules(status);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Overview
      </h1>

      <div className="kpi-strip">
        <KpiTile
          label="Active blocks"
          value={String(hardBlocks.length)}
          hint={
            activeBlocks.length
              ? `${blockedSources} source${blockedSources === 1 ? '' : 's'} blocked${throttles ? ` · ${throttles} throttled` : ''}`
              : 'Nothing blocked right now'
          }
          to="/blocks"
          state={tileState(hardBlocks.length)}
          asOf={dataAt}
        />
        <KpiTile
          label="Detect p95"
          value={formatLatency(overview?.ttdP95Ms)}
          hint={overview?.ttdP95Ms == null ? 'No detections in 24 h' : 'Trigger event → incident, 24 h'}
          state={tileState(overview?.ttdP95Ms)}
          asOf={dataAt}
        />
        <KpiTile
          label="Remediate p95"
          value={formatLatency(overview?.ttrP95Ms)}
          hint={overview?.ttrP95Ms == null ? 'No actions in 24 h' : 'Trigger event → action applied, 24 h'}
          state={tileState(overview?.ttrP95Ms)}
          asOf={dataAt}
        />
        <KpiTile
          label="Last pipeline"
          value="—"
          hint="Pipeline results arrive on Oct 22"
          to="/pipeline"
          state={!loaded ? 'loading' : stale ? 'stale' : 'empty'}
          asOf={dataAt}
        />
      </div>

      <div className="overview-grid">
        <section className="panel" aria-labelledby="feed-title">
          <h2 id="feed-title" className="panel__title">
            Incident feed
          </h2>
          {error && !loaded ? (
            <EmptyState hint={error.message}>Could not load incidents.</EmptyState>
          ) : loaded && incidents.length === 0 ? (
            <EmptyState hint={rules.length ? `Kairo is watching ${rules.length} rule${rules.length === 1 ? '' : 's'} in Enforce: ${rules.join(', ')}.` : undefined}>
              No incidents in the last 24 h.
            </EmptyState>
          ) : !loaded ? (
            <EmptyState>Waiting for the Defender…</EmptyState>
          ) : (
            <div className="feed-scroll">
              <table className="feed">
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Signal</th>
                    <th scope="col">Source</th>
                    <th scope="col">Action</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Expires
                    </th>
                  </tr>
                </thead>
                <tbody onKeyDown={onFeedKey}>
                  {incidents.map((incident, i) => (
                    <IncidentRow
                      key={incident._id}
                      incident={incident}
                      action={deriveActionState(incident, blocks, now)}
                      now={now}
                      isNew={freshIds.has(incident._id)}
                      isLatest={i === 0}
                      selected={incident._id === selectedId}
                      tabIndex={i === Math.min(focusIndex, incidents.length - 1) ? 0 : -1}
                      onOpen={openIncident}
                      onFocus={() => setFocusIndex(i)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel" aria-labelledby="rail-title">
          <h2 id="rail-title" className="panel__title">
            Active blocks
          </h2>
          {!loaded ? (
            <EmptyState>Waiting for the Defender…</EmptyState>
          ) : activeBlocks.length === 0 ? (
            <EmptyState>Nothing blocked right now.</EmptyState>
          ) : (
            <ul className="rail__list">
              {activeBlocks.map((block) => (
                <BlockCard
                  key={`${block.level}:${block.scope}:${block.subject}`}
                  block={block}
                  now={now}
                  disabled={stale}
                  onUnblocked={(b) => removeBlocksFor(b.scope, b.subject)}
                />
              ))}
            </ul>
          )}
        </aside>
      </div>

      <Outlet context={{ incidents, blocks, now, stale, removeBlocksFor }} />

      <div role="status" aria-live="polite" className="visually-hidden">
        {announcement}
      </div>
    </section>
  );
}

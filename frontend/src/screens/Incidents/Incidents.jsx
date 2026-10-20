// S3 Incidents (BRIEF §6, PHASES Oct 21 #5): FilterBar (rule, severity,
// state, time range, source hash) → DataTable with the feed's columns plus
// Opened and Closed → 50 rows a page. Default: last 24 h, every state.
// Filters live in the URL. Keyboard as in the feed (BRIEF §10): one tab stop,
// ↑/↓ or j/k move, Enter opens the incident drawer (?open=<id>), and Esc
// returns focus to that row.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import EmptyState from '../../components/EmptyState.jsx';
import IncidentRow from '../../components/IncidentRow.jsx';
import IncidentDrawer from '../Overview/IncidentDrawer.jsx';
import { useBlocks } from '../../hooks/useBlocks.js';
import { useConsole } from '../../hooks/useConsole.js';
import { useIncidents, PAGE_SIZE } from '../../hooks/useIncidents.js';
import { useNow } from '../../hooks/useNow.js';
import { deriveActionState } from '../../utils/incidentState.js';
import { formatClock } from '../../utils/formatTime.js';
import { DEFAULT_RANGE, RANGES, SEVERITIES, STATES, isFiltered, isSourceQuery, readFilters } from '../../utils/incidentFilters.js';
import { actionBlockedReason, isStale } from '../../utils/systemState.js';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function Select({ label, value, onChange, children }) {
  return (
    <label className="filterbar__field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

export default function Incidents() {
  const { connection, connectionSince, status } = useConsole();
  const stale = isStale(connection);
  const blockedReason = actionBlockedReason(connection, status);
  const killSwitch = Boolean(status?.killSwitch);
  const now = useNow(stale);
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const openId = ULID.test(params.get('open') ?? '') ? params.get('open') : null;
  const { items, loaded, error, pageIndex, hasOlder, older, newer } = useIncidents(filters, connection);
  const { blocks, removeBlocksFor } = useBlocks(connection, status?.redis);
  const [focusIndex, setFocusIndex] = useState(0);
  const [source, setSource] = useState(filters.source);
  useEffect(() => setSource(filters.source), [filters.source]);

  const ruleIds = (status?.rules ?? []).map((r) => r.id);

  // Built from the live URL, not this render's params: two quick changes in a
  // row must not overwrite each other (setSearchParams' updater gets the
  // render-time params).
  const updateParams = useCallback(
    (change) => {
      const next = new URLSearchParams(window.location.search);
      change(next);
      setParams(next);
    },
    [setParams]
  );
  const setFilter = (key, value) => {
    updateParams((next) => {
      if (value && !(key === 'range' && value === DEFAULT_RANGE)) next.set(key, value);
      else next.delete(key);
      next.delete('open');
    });
    setFocusIndex(0);
  };
  const clear = () => setParams(new URLSearchParams());

  const open = (id) => updateParams((next) => next.set('open', id));
  const closeDrawer = useCallback(() => updateParams((next) => next.delete('open')), [updateParams]);

  const onTableKey = (e) => {
    const rows = [...e.currentTarget.querySelectorAll('tr[data-incident-id]')];
    const i = rows.indexOf(document.activeElement);
    if (i === -1) return;
    const move = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    if (move) {
      e.preventDefault();
      const n = Math.max(0, Math.min(rows.length - 1, i + move));
      setFocusIndex(n);
      rows[n].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(rows[i].dataset.incidentId);
    }
  };

  const sourceValid = !source || isSourceQuery(source);
  const range = RANGES.find((r) => r.value === filters.range);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Incidents
      </h1>

      <div className="filterbar" role="search" aria-label="Filter incidents">
        <Select label="Rule" value={filters.rule} onChange={(v) => setFilter('rule', v)}>
          <option value="">All rules</option>
          {ruleIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Select>
        <Select label="Severity" value={filters.severity} onChange={(v) => setFilter('severity', v)}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
        <Select label="State" value={filters.state} onChange={(v) => setFilter('state', v)}>
          <option value="">All states</option>
          {STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select label="Time" value={filters.range} onChange={(v) => setFilter('range', v)}>
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <form
          className="filterbar__field"
          onSubmit={(e) => {
            e.preventDefault();
            if (sourceValid) setFilter('source', source.trim().toLowerCase().replace(/^ip:/, ''));
          }}
        >
          <label htmlFor="source-filter">Source hash</label>
          <input
            id="source-filter"
            className="input mono"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onBlur={() => sourceValid && source.trim().toLowerCase().replace(/^ip:/, '') !== filters.source && setFilter('source', source.trim().toLowerCase().replace(/^ip:/, ''))}
            placeholder="ip:3e9a…"
            aria-invalid={!sourceValid || undefined}
            aria-describedby="source-hint"
            spellCheck="false"
            autoComplete="off"
          />
          <span id="source-hint" className={`filterbar__hint${sourceValid ? '' : ' filterbar__hint--bad'}`}>
            {sourceValid ? 'Hash or its first 4+ characters' : 'Hashes only: 4–16 hex characters'}
          </span>
        </form>
        {isFiltered(filters) && (
          <button type="button" className="btn btn--secondary filterbar__clear" onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      <div className="panel">
        <p className="incidents__summary" aria-live="polite">
          {loaded
            ? `${items.length === PAGE_SIZE || pageIndex > 0 ? `Page ${pageIndex + 1} · ` : ''}${items.length} incident${items.length === 1 ? '' : 's'} · ${range.label.toLowerCase()}`
            : '—'}
          {stale && <span className="stale-stamp">as of {formatClock(connectionSince)}</span>}
        </p>
        {error && !loaded ? (
          <EmptyState hint={error.message}>Could not load incidents.</EmptyState>
        ) : !loaded ? (
          <EmptyState>Waiting for the Defender…</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState hint={isFiltered(filters) ? 'Try a wider time range or clear the filters.' : undefined}>No incidents match.</EmptyState>
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
                  <th scope="col">Opened</th>
                  <th scope="col">Closed</th>
                </tr>
              </thead>
              <tbody onKeyDown={onTableKey}>
                {items.map((incident, i) => (
                  <IncidentRow
                    key={incident._id}
                    incident={incident}
                    action={deriveActionState(incident, blocks, now, { killSwitch })}
                    now={now}
                    selected={incident._id === openId}
                    tabIndex={i === Math.min(focusIndex, items.length - 1) ? 0 : -1}
                    onOpen={open}
                    onFocus={() => setFocusIndex(i)}
                    wide
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(pageIndex > 0 || hasOlder) && (
          <div className="incidents__pager">
            <button type="button" className="btn btn--secondary" onClick={newer} disabled={pageIndex === 0}>
              ← Newer
            </button>
            <span className="mono">Page {pageIndex + 1}</span>
            <button type="button" className="btn btn--secondary" onClick={older} disabled={!hasOlder}>
              Older →
            </button>
          </div>
        )}
      </div>

      {openId && (
        <IncidentDrawer
          key={openId}
          id={openId}
          onClose={closeDrawer}
          context={{ incidents: items, blocks, now, blockedReason, killSwitch, removeBlocksFor }}
        />
      )}
    </section>
  );
}

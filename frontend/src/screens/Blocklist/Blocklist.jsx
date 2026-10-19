// S4 Blocklist (BRIEF §6): summary line → scope filter → one row per active
// block or throttle, soonest expiry first, each with its reason, a live
// countdown and Unblock (with Undo). Bulk unblock, the allowlist panel and
// manual blocks are cut from the Demo MVP (PHASES §1).

import { useState } from 'react';

import BlockRow from '../../components/BlockRow.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { useBlocks } from '../../hooks/useBlocks.js';
import { useConsole } from '../../hooks/useConsole.js';
import { useNow } from '../../hooks/useNow.js';
import { summarizeBlocks } from '../../utils/summarizeBlocks.js';
import { formatClock } from '../../utils/formatTime.js';
import { actionBlockedReason, isRedisDown, isStale } from '../../utils/systemState.js';

const FILTERS = [
  { value: null, label: 'All' },
  { value: 'auth', label: 'auth' },
  { value: 'room_join', label: 'rooms' },
];

export default function Blocklist() {
  const { connection, connectionSince, status } = useConsole();
  const stale = isStale(connection);
  const redisDown = isRedisDown(connection, status);
  const blockedReason = actionBlockedReason(connection, status);
  const killSwitch = Boolean(status?.killSwitch);
  const now = useNow(stale);
  const { blocks, incidents, cap, loaded, error, lastExpiryAt, removeBlocksFor } = useBlocks(connection, status?.redis);
  const [scope, setScope] = useState(null);

  const active = blocks.filter((b) => b.expiresAt > now);
  const shown = active.filter((b) => !scope || b.scope === scope).sort((a, b) => a.expiresAt - b.expiresAt);
  const summary = summarizeBlocks(active, now, cap);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Blocklist
      </h1>

      <div className="blocklist__bar">
        <p className="blocklist__summary" aria-live="off">
          {redisDown ? 'Unknown while Redis is unreachable' : loaded ? summary.text : '—'}
          {stale && <span className="stale-stamp">as of {formatClock(connectionSince)}</span>}
          {killSwitch && <span className="blocklist__held"> · held back by the kill switch</span>}
        </p>
        <div className="segmented" role="group" aria-label="Filter by scope">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              className="segmented__option"
              aria-pressed={scope === f.value}
              onClick={() => setScope(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        {redisDown ? (
          <EmptyState hint="They can't be read while Redis is down, and none of them is being enforced.">Blocks hidden: Redis is unreachable.</EmptyState>
        ) : error && !loaded ? (
          <EmptyState hint={error.message}>Could not load active blocks.</EmptyState>
        ) : !loaded ? (
          <div className="skeleton skeleton--block" aria-label="Loading active blocks" />
        ) : shown.length === 0 ? (
          <EmptyState hint={lastExpiryAt ? `Last block expired at ${formatClock(lastExpiryAt)}.` : undefined}>
            {scope && active.length ? 'Nothing blocked in this scope.' : 'Nothing blocked right now.'}
          </EmptyState>
        ) : (
          <div className="feed-scroll">
            <table className="feed blocklist">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Action</th>
                  <th scope="col">Rule</th>
                  <th scope="col">Reason</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Time left
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <BlockRow
                    key={`${b.level}:${b.scope}:${b.subject}`}
                    block={b}
                    incident={incidents.get(b.incidentId)}
                    now={now}
                    blockedReason={blockedReason}
                    killSwitch={killSwitch}
                    onUnblocked={(x) => removeBlocksFor(x.scope, x.subject)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

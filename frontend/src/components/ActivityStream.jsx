// Live activity (PHASES Oct 21 #2, BRIEF §10): the latest 30 raw events,
// newest first: time, type, hashed source, route or event name. Hashes and
// metadata only. Hovering or focusing it pauses it (and the Live traffic
// chart) with a count of what arrived meanwhile.

import EmptyState from './EmptyState.jsx';
import HashValue from './HashValue.jsx';
import { formatClock } from '../utils/formatTime.js';

export default function ActivityStream({ rows, newCount, loaded, error, paused, onPause }) {
  return (
    <section
      className="panel activity"
      aria-labelledby="activity-title"
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && onPause(false)}
    >
      <div className="live__head">
        <h2 id="activity-title" className="panel__title">
          Live activity
        </h2>
        <span className={`live__note${paused ? ' live__note--paused' : ''}`} aria-live="polite">
          {paused ? (newCount ? `Paused · ${newCount} new` : 'Paused while you read') : 'Latest 30 events · hashes only'}
        </span>
      </div>
      {error && !rows.length ? (
        <EmptyState hint={error.message}>Could not load events.</EmptyState>
      ) : loaded && !rows.length ? (
        <EmptyState hint="Events appear here as CypherFy answers logins, room joins and socket traffic.">No events yet.</EmptyState>
      ) : (
        <div className="activity__scroll" tabIndex={0} aria-label="Latest 30 events, newest first. Paused while focused.">
          <table className="activity__table mono">
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Type</th>
                <th scope="col">Source</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="activity__time">{formatClock(r.ts)}</td>
                  <td className="activity__type">{r.type}</td>
                  <td>
                    <HashValue kind={r.sourceKind} value={r.source} />
                  </td>
                  <td className="activity__detail">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

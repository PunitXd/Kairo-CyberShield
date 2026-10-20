// One incident in the feed (BRIEF §6 S1, §7). Every automatic action shows a
// reason, a countdown and (on the rail and in the drawer) an undo, principle 1.
// The row is updated in place as an incident escalates, never duplicated
// (Flow A). New rows highlight once for 2 s and settle; nothing blinks.
// Click or Enter opens the incident drawer. The feed is one tab stop with
// roving focus (BRIEF §10); the parent moves focus with ↑/↓ or j/k.

import SeverityGlyph from './SeverityGlyph.jsx';
import ActionPill from './ActionPill.jsx';
import Countdown from './Countdown.jsx';
import HashValue from './HashValue.jsx';
import { formatClock } from '../utils/formatTime.js';

// The Incidents screen adds Opened and Closed (BRIEF §6 S3): today's times as
// 14:02:11, older ones with the date.
const when = (d, now) => {
  if (!d) return '—';
  const ms = new Date(d).getTime();
  if (now - ms < 20 * 3600_000) return formatClock(ms);
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
};

export default function IncidentRow({ incident, action, now, isNew, isLatest, selected, tabIndex, onOpen, onFocus, wide = false }) {
  const classes = ['row', 'row--interactive'];
  if (isNew) classes.push('row--new');
  if (isLatest) classes.push('row--latest');
  if (selected) classes.push('row--selected');
  return (
    <tr
      className={classes.join(' ')}
      data-incident-id={incident._id}
      tabIndex={tabIndex}
      aria-selected={selected || undefined}
      aria-label={`${incident.severity} severity, ${incident.ruleId}: ${incident.summary}. Press Enter for details.`}
      onClick={(e) => {
        if (e.target.closest('button')) return; // the copy button inside HashValue
        onOpen(incident._id);
      }}
      onFocus={onFocus}
    >
      <td className="row__sev">
        <SeverityGlyph level={incident.severity} />
      </td>
      <td className="row__signal">
        <span className="row__summary">{incident.summary}</span>
        <span className="row__rule mono">
          {incident.ruleId}
          {incident.ruleVersion ? ` v${incident.ruleVersion}` : ''}
          {incident.falsePositive ? ' · false positive' : ''}
        </span>
      </td>
      <td>
        {incident.subjectKind === 'deploy' ? (
          <span className="mono" title={`image cypherfy-backend:${incident.subject}`}>
            deploy:{String(incident.subject).slice(0, 7)}
          </span>
        ) : (
          <HashValue kind="ip" value={incident.subject} />
        )}
      </td>
      <td>
        <ActionPill state={action.state} scope={action.scope} reason={action.reason} />
      </td>
      <td className="row__expires">
        <Countdown expiresAt={action.expiresAt} now={now} />
      </td>
      {wide && (
        <>
          <td className="row__time mono">{when(incident.detectedAt, now)}</td>
          <td className="row__time mono">{when(incident.closedAt, now)}</td>
        </>
      )}
    </tr>
  );
}

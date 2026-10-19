// One incident in the feed (BRIEF §6 S1, §7). Every automatic action shows a
// reason, a countdown and (on the rail) an undo — principle 1. The row is
// updated in place as an incident escalates, never duplicated (Flow A).
// New rows highlight once for 2 s and settle; nothing blinks or loops.

import SeverityGlyph from './SeverityGlyph.jsx';
import ActionPill from './ActionPill.jsx';
import Countdown from './Countdown.jsx';
import HashValue from './HashValue.jsx';

export default function IncidentRow({ incident, action, now, isNew, isLatest }) {
  return (
    <tr className={`row${isNew ? ' row--new' : ''}${isLatest ? ' row--latest' : ''}`} data-incident-id={incident._id}>
      <td className="row__sev">
        <SeverityGlyph level={incident.severity} />
      </td>
      <td className="row__signal">
        <span className="row__summary">{incident.summary}</span>
        <span className="row__rule mono">
          {incident.ruleId}
          {incident.ruleVersion ? ` v${incident.ruleVersion}` : ''}
        </span>
      </td>
      <td>
        <HashValue kind="ip" value={incident.subject} />
      </td>
      <td>
        <ActionPill state={action.state} scope={action.scope} reason={action.reason} />
      </td>
      <td className="row__expires">
        <Countdown expiresAt={action.expiresAt} now={now} />
      </td>
    </tr>
  );
}

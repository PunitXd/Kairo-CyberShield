// BlockCard in table-row form for the Blocklist screen (BRIEF §6 S4, §7):
// source, action, rule, the incident's own reason, time left, Unblock (same
// one-click + Undo flow as the rail) and a link to the incident drawer.

import { Link } from 'react-router';

import ActionPill from './ActionPill.jsx';
import Countdown from './Countdown.jsx';
import HashValue from './HashValue.jsx';
import { useUnblock } from '../hooks/useUnblock.js';
import { formatClock } from '../utils/formatTime.js';

export default function BlockRow({ block, incident, now, disabled = false, killSwitch = false, onUnblocked }) {
  const { state, error, unblock, label } = useUnblock({ scope: block.scope, subject: block.subject, onUnblocked });
  const busy = state === 'unblocking';

  return (
    <tr className={`row${state === 'failed' ? ' row--failed' : ''}`}>
      <td>
        <HashValue kind="ip" value={block.subject} />
      </td>
      <td>
        {killSwitch ? (
          <ActionPill state="shadow" reason="kill switch" />
        ) : (
          <ActionPill state={block.level === 'block' ? 'blocked' : 'throttled'} scope={block.scope} />
        )}
      </td>
      <td className="mono">{block.rule ?? '—'}</td>
      <td className="blocklist__reason">
        {incident?.summary ?? <span className="empty-state__hint">—</span>}
        {state === 'failed' && (
          <span className="block-card__error" role="alert">
            {' '}
            Unblock failed: {error}
          </span>
        )}
      </td>
      <td className="row__expires">
        <Countdown expiresAt={block.expiresAt} now={now} />
        <span className="blocklist__at">{formatClock(block.expiresAt)}</span>
      </td>
      <td className="blocklist__actions">
        {block.incidentId && (
          <Link to={`/incidents/${block.incidentId}`} className="blocklist__link">
            View incident
          </Link>
        )}
        <button
          type="button"
          className="btn btn--secondary"
          onClick={unblock}
          disabled={busy || disabled}
          aria-busy={busy || undefined}
          aria-label={`Unblock ${label}`}
          title={disabled ? 'The Defender is unreachable; actions are paused' : undefined}
        >
          {busy ? 'Unblocking…' : state === 'failed' ? 'Retry' : 'Unblock'}
        </button>
      </td>
    </tr>
  );
}

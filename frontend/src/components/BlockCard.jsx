// An active block or throttle on the rail (BRIEF §6 S1, §7). The feed
// explains; the rail is where you reverse.
//
// States: active, under 60 s, unblocking (button busy), removed once the
// Defender confirms (never optimistically), failed (inline error + Retry).
// While the Defender or Redis is unreachable the button is disabled with the reason.

import ActionPill from './ActionPill.jsx';
import Countdown from './Countdown.jsx';
import HashValue from './HashValue.jsx';
import { useUnblock } from '../hooks/useUnblock.js';

export default function BlockCard({ block, now, blockedReason = null, killSwitch = false, onUnblocked }) {
  const { state, error, unblock, label } = useUnblock({ scope: block.scope, subject: block.subject, onUnblocked });
  const busy = state === 'unblocking';

  return (
    <li className={`block-card${state === 'failed' ? ' block-card--failed' : ''}`}>
      <div className="block-card__top">
        <HashValue kind="ip" value={block.subject} />
        <span className="block-card__rule mono">{block.rule ?? '—'}</span>
      </div>
      <div className="block-card__bottom">
        {killSwitch ? (
          <ActionPill state="shadow" reason="kill switch" />
        ) : (
          <ActionPill state={block.level === 'block' ? 'blocked' : 'throttled'} scope={block.scope} />
        )}
        <Countdown expiresAt={block.expiresAt} now={now} />
        <button
          type="button"
          className="btn btn--secondary"
          onClick={unblock}
          disabled={busy || Boolean(blockedReason)}
          aria-busy={busy || undefined}
          aria-label={`Unblock ${label}`}
          title={blockedReason ?? undefined}
        >
          {busy ? 'Unblocking…' : state === 'failed' ? 'Retry' : 'Unblock'}
        </button>
      </div>
      {state === 'failed' && (
        <p className="block-card__error" role="alert">
          Unblock failed: {error}
        </p>
      )}
    </li>
  );
}

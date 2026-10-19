// An active block or throttle on the rail (BRIEF §6 S1, §7). The feed
// explains; the rail is where you reverse.
//
// Unblock is one click with a 10 s Undo toast: it reduces enforcement, so it
// needs no confirmation (BRIEF principle 1). States: active, under 60 s,
// unblocking (button busy), removed once the Defender confirms (never
// optimistically), failed (inline error + Retry). While the Defender is
// unreachable the button is disabled with the reason.

import { useState } from 'react';

import ActionPill from './ActionPill.jsx';
import Countdown from './Countdown.jsx';
import HashValue from './HashValue.jsx';
import { deleteBlock, undoUnblock } from '../services/api.service.js';
import { showToast } from '../services/toast.service.js';
import { formatHash } from '../utils/formatHash.js';
import { SCOPE_LABEL } from '../utils/incidentState.js';

export default function BlockCard({ block, now, disabled = false, onUnblocked }) {
  const [state, setState] = useState('active'); // active | unblocking | failed
  const [error, setError] = useState(null);
  const source = `${formatHash('ip', block.subject)} · ${SCOPE_LABEL[block.scope] ?? block.scope}`;

  const undo = async (undoToken) => {
    try {
      const { restored } = await undoUnblock(undoToken);
      showToast({ message: restored ? `Restored ${source}` : `Nothing to restore for ${source}: it would have expired`, durationMs: 4000 });
    } catch (err) {
      showToast({ message: err.code === 'UNDO_EXPIRED' ? 'Undo window passed: the block stays lifted' : `Undo failed: ${err.message}`, tone: 'error', durationMs: 6000 });
    }
  };

  const unblock = async () => {
    setState('unblocking');
    setError(null);
    try {
      const { undoToken } = await deleteBlock(block.scope, block.subject);
      onUnblocked?.(block);
      showToast({ message: `Unblocked ${source}`, action: { label: 'Undo', onAction: () => undo(undoToken) } });
    } catch (err) {
      if (err.status === 404) {
        onUnblocked?.(block); // already lifted (expired or unblocked elsewhere)
        return;
      }
      setState('failed');
      setError(err.message);
    }
  };

  const busy = state === 'unblocking';
  return (
    <li className={`block-card${state === 'failed' ? ' block-card--failed' : ''}`}>
      <div className="block-card__top">
        <HashValue kind="ip" value={block.subject} />
        <span className="block-card__rule mono">{block.rule ?? '—'}</span>
      </div>
      <div className="block-card__bottom">
        <ActionPill state={block.level === 'block' ? 'blocked' : 'throttled'} scope={block.scope} />
        <Countdown expiresAt={block.expiresAt} now={now} />
        <button
          type="button"
          className="btn btn--secondary"
          onClick={unblock}
          disabled={busy || disabled}
          aria-busy={busy || undefined}
          title={disabled ? 'The Defender is unreachable; actions are paused' : `Lift every block and throttle on ${source}`}
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

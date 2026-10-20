// Mark false positive (BRIEF §6 S2 action bar, Flow B step 4). It records the
// incident as a false positive (counted per rule on the Rules screen) and,
// only if ticked, allowlists the source for 24 h. Allowlisting reduces
// protection for a day, so the popover names that before anything happens.
// It does not unblock: Unblock stays its own action.

import { useCallback, useRef, useState } from 'react';

import ConfirmPopover from './ConfirmPopover.jsx';
import { markFalsePositive } from '../services/api.service.js';
import { showToast } from '../services/toast.service.js';
import { formatHash, isHash } from '../utils/formatHash.js';
import { formatClock } from '../utils/formatTime.js';

const HOURS = 24;

export default function FalsePositiveControl({ incident, allowlisted, blockedReason, onDone }) {
  const [open, setOpen] = useState(false);
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const triggerRef = useRef(null);
  const canAllow = isHash(incident.subject) && !allowlisted;
  const who = formatHash('ip', incident.subject);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // Nothing left to do here once it is marked and its source is allowlisted (or can't be).
  if (incident.falsePositive && !canAllow) return null;
  const allowOnly = incident.falsePositive; // already marked: the button only allowlists

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await markFalsePositive(incident._id, { allowlistHours: allowOnly || allow ? HOURS : undefined });
      showToast({
        message: r.allowlisted ? `${allowOnly ? '' : 'Marked false positive · '}${who} allowlisted until ${formatClock(r.allowlisted.expiresAt)}` : `Marked false positive · ${incident.ruleId}`,
      });
      close();
      onDone?.();
    } catch (err) {
      setError(`Could not save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="killswitch">
      <button
        type="button"
        ref={triggerRef}
        className="btn btn--secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={Boolean(blockedReason)}
        title={blockedReason ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {allowOnly ? `Allowlist for ${HOURS} h` : 'Mark false positive'}
      </button>
      {open && (
        <ConfirmPopover
          id={`fp-${incident._id}`}
          title={allowOnly ? `Allowlist ${who} for ${HOURS} h?` : 'Mark as a false positive?'}
          confirmLabel={allowOnly || allow ? `${allowOnly ? 'Allowlist' : 'Mark + allowlist'} ${HOURS} h` : 'Mark false positive'}
          tone={allowOnly || allow ? 'danger' : 'primary'}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={close}
        >
          {!allowOnly && <p>It counts against {incident.ruleId} on the Rules screen, so repeated false positives point at a threshold to tune.</p>}
          {canAllow && !allowOnly && (
            <label className="fp__allow">
              <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Also allowlist {who} for {HOURS} h
            </label>
          )}
          {(allowOnly || allow) && (
            <p>Kairo will not block, throttle or disconnect {who} for {HOURS} h, even if it attacks again. Its active blocks stop applying too.</p>
          )}
        </ConfirmPopover>
      )}
    </span>
  );
}

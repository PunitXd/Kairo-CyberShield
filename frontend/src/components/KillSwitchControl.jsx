// The global kill switch (PRD F8, BRIEF §6 top bar, §8). It confirms in both
// directions (BRIEF §1): on stops all enforcement at once; off resumes it.
// The copy names the blast radius. No keyboard shortcut, on purpose (BRIEF §10).
// Used in the top bar and, while on, in the critical banner ("Turn off").

import { useCallback, useRef, useState } from 'react';

import ConfirmPopover from './ConfirmPopover.jsx';
import { setKillSwitch } from '../services/api.service.js';

export default function KillSwitchControl({ status, disabled = false, variant = 'topbar' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const triggerRef = useRef(null);
  const on = Boolean(status?.killSwitch);
  const enforcing = (status?.rules ?? []).filter((r) => r.mode === 'enforce').map((r) => r.id);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await setKillSwitch(!on); // the new state arrives as system.status over the socket
      close();
    } catch (err) {
      setError(`Could not change the kill switch: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const label = on ? 'Turn off' : 'Kill switch';
  return (
    <span className={`killswitch killswitch--${variant}`}>
      <button
        type="button"
        ref={triggerRef}
        className={`btn ${on ? 'btn--primary' : 'btn--danger'}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !status}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={disabled ? 'The Defender is unreachable' : undefined}
      >
        {variant === 'banner' ? 'Turn off' : label}
      </button>
      {open && (
        <ConfirmPopover
          id={`killswitch-${variant}`}
          title={on ? 'Turn off the kill switch?' : 'Turn on the kill switch?'}
          confirmLabel={on ? 'Turn off · resume blocking' : 'Turn on · stop all blocking'}
          tone={on ? 'primary' : 'danger'}
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={close}
        >
          {on ? (
            <p>
              Rules in Enforce ({enforcing.join(', ') || 'none'}) resume blocking and throttling, and blocks that are still
              active apply again.
            </p>
          ) : (
            <p>
              Every rule switches to Shadow: Kairo keeps detecting and recording incidents, but stops blocking and throttling,
              and existing blocks stop being enforced until you turn it off.
            </p>
          )}
        </ConfirmPopover>
      )}
    </span>
  );
}

// Anchored confirmation (BRIEF §7): the copy names the blast radius, e.g.
// "Every rule switches to Shadow…". Focus starts on Cancel (the safe choice),
// Esc or a click outside cancels, and the caller returns focus to the trigger.

import { useEffect, useRef } from 'react';

export default function ConfirmPopover({ id, title, children, confirmLabel, tone = 'danger', busy = false, error = null, onConfirm, onCancel }) {
  const ref = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onCancel]);

  return (
    <div className="popover" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} ref={ref}>
      <p id={`${id}-title`} className="popover__title">
        {title}
      </p>
      <div className="popover__body">{children}</div>
      {error && (
        <p className="block-card__error" role="alert">
          {error}
        </p>
      )}
      <div className="popover__actions">
        <button type="button" className="btn btn--secondary" onClick={onCancel} ref={cancelRef}>
          Cancel
        </button>
        <button type="button" className={`btn btn--${tone}`} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

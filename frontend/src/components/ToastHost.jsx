// Toasts, bottom-left (BRIEF §7). Each one auto-dismisses after its duration;
// the timer pauses while the toast is hovered or has focus, so an operator
// reaching for Undo never loses it mid-move. Announced politely.

import { useEffect, useRef, useState } from 'react';

import { useToasts } from '../hooks/useToasts.js';
import { dismissToast } from '../services/toast.service.js';

function Toast({ toast }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismissToast(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.id]);

  return (
    <div
      className={`toast toast--${toast.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            dismissToast(toast.id);
            toast.action.onAction();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
        ×
      </button>
    </div>
  );
}

export default function ToastHost() {
  const toasts = useToasts();
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}

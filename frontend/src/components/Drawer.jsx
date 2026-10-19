// Right-side drawer, 480 px (BRIEF §6 S2, §7). Not modal: the feed beside it
// stays visible and live. Opening moves focus to the heading; Esc or the
// close button calls onClose (the caller returns focus to what opened it).

import { useEffect, useRef } from 'react';

export default function Drawer({ title, onClose, children, labelledBy = 'drawer-title' }) {
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby={labelledBy}>
      <div className="drawer__head">
        <h2 id={labelledBy} className="drawer__title" tabIndex={-1} ref={headingRef}>
          {title}
        </h2>
        <button type="button" className="drawer__close" onClick={onClose} aria-label="Close incident details (Esc)">
          ×
        </button>
      </div>
      <div className="drawer__body">{children}</div>
    </aside>
  );
}

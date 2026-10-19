// One sentence and, optionally, a hint or action. No icon (BRIEF §7).

export default function EmptyState({ children, hint }) {
  return (
    <div className="empty-state">
      <p>{children}</p>
      {hint && <p className="empty-state__hint">{hint}</p>}
    </div>
  );
}

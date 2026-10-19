// The exact event fields an incident was built from (BRIEF principle 3,
// §7 FieldChips): one mono chip per field name. Only names, never values.

export default function FieldChips({ fields = [] }) {
  if (!fields.length) return <p className="empty-state__hint">No fields recorded.</p>;
  return (
    <ul className="chips" aria-label="Fields received">
      {fields.map((f) => (
        <li key={f} className="chip mono">
          {f}
        </li>
      ))}
    </ul>
  );
}

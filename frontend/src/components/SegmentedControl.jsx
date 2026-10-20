// SegmentedControl (BRIEF §7): a small group of mutually exclusive buttons,
// the current one pressed. Options can be disabled with a reason (tooltip).

export default function SegmentedControl({ label, options, value, onChange, disabled = false, title }) {
  return (
    <div className="segmented" role="group" aria-label={label} title={title}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`segmented__option segmented__option--${o.value}`}
          aria-pressed={value === o.value}
          disabled={disabled || o.disabled}
          title={o.disabled ? o.reason : undefined}
          onClick={(e) => value !== o.value && onChange(o.value, e.currentTarget)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

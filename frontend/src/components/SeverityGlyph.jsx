// Severity = 4-bar glyph + word, never colour alone (BRIEF §3). Critical also
// gets a solid tile. Mapping per BRIEF D9: R1a Medium, R1b High, R2a Medium.

const LEVELS = {
  info: { bars: 0, word: 'Info' },
  low: { bars: 1, word: 'Low' },
  medium: { bars: 2, word: 'Medium' },
  high: { bars: 3, word: 'High' },
  critical: { bars: 4, word: 'Critical' },
};

export default function SeverityGlyph({ level }) {
  const { bars, word } = LEVELS[level] ?? LEVELS.info;
  return (
    <span className={`sev sev--${LEVELS[level] ? level : 'info'}`}>
      <span className="sev__bars" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`sev__bar${i < bars ? ' sev__bar--on' : ''}`} style={{ height: `${5 + i * 3}px` }} />
        ))}
      </span>
      <span className="sev__word">{word}</span>
    </span>
  );
}

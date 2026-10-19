// One scanner finding (BRIEF Flow C): file:line, rule, severity and, for a
// secret, only the redacted value the Defender stored ("AKIA••••••••"). The
// full secret never reaches the console: the workflow redacts it and the
// Defender redacts it again before storing.

export default function FindingRow({ finding }) {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  return (
    <li className="finding">
      <span className="finding__where mono">{where}</span>
      <span className="finding__rule mono">{finding.ruleId}</span>
      <span className={`finding__sev finding__sev--${finding.severity}`}>{finding.severity}</span>
      {finding.redacted && (
        <span className="finding__value mono" aria-label={`Redacted value starting ${finding.redacted.replace(/•+$/, '') || 'hidden'}`}>
          {finding.redacted}
        </span>
      )}
      {finding.title && <span className="finding__title">{finding.title}</span>}
      {finding.commit && <span className="finding__commit mono">in {finding.commit}</span>}
      {finding.tool === 'npm-audit' && <span className="finding__commit">{finding.fixAvailable ? 'fix available' : 'no fix yet'}</span>}
    </li>
  );
}

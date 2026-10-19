// Environment + mode, always visible (BRIEF §6): enforcing on the wrong
// environment is the most expensive mistake this tool can make. Text always
// shows both, e.g. "STAGING · enforce". The Defender only enforces in staging,
// and the kill switch turns every rule to shadow. While the Defender is
// unreachable the last known value stays on screen, marked stale (BRIEF §8).

import { formatClock } from '../utils/formatTime.js';

export default function EnvChip({ status, stale = false, statusAt = null }) {
  if (!status) {
    return <span className="env-chip env-chip--shadow">connecting…</span>;
  }
  const enforcing = status.env === 'staging' && !status.killSwitch;
  const mode = enforcing ? 'enforce' : status.killSwitch ? 'shadow (kill switch)' : 'shadow';
  const title = stale
    ? `Last known state, as of ${formatClock(statusAt)}. The Defender is unreachable.`
    : enforcing
      ? 'Kairo is acting on detections'
      : 'Kairo is detecting but not acting';
  return (
    <span className={`env-chip${enforcing && !stale ? '' : ' env-chip--shadow'}`} title={title}>
      {String(status.env).toUpperCase()} · {mode}
      {stale && <span className="visually-hidden"> (stale)</span>}
    </span>
  );
}

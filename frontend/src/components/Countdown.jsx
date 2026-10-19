// Live countdown (BRIEF §7): mono, tabular figures, once per second, digits
// never animate. Under 60 s it gets heavier; at zero it reads "expired".
// The ticking number is aria-hidden (noise for a screen reader); the expiry
// time is exposed as text instead.

import { formatCountdown } from '../utils/formatDuration.js';
import { formatClock } from '../utils/formatTime.js';

export default function Countdown({ expiresAt, now }) {
  if (!expiresAt) return <span className="countdown countdown--none">—</span>;
  const left = expiresAt - now;
  const urgent = left > 0 && left < 60_000;
  return (
    <span className={`countdown mono${urgent ? ' countdown--urgent' : ''}${left <= 0 ? ' countdown--expired' : ''}`}>
      <span aria-hidden="true">{formatCountdown(left)}</span>
      <span className="visually-hidden">{left > 0 ? `expires at ${formatClock(expiresAt)}` : 'expired'}</span>
    </span>
  );
}

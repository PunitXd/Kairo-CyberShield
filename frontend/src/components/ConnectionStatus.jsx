// Defender, Redis and Hooks status (BRIEF §7). The shape changes with the
// state (● live, ◔ reconnecting, ○ down), never only the colour.
//
// Hooks: the hooks heartbeat is not built in the Demo MVP, so this reports
// honestly whether Kairo has received events from CypherFy since the Defender
// started, rather than claiming a live link.

import { formatClock, formatElapsed } from '../utils/formatTime.js';

const GLYPH = { live: '●', reconnecting: '◔', down: '○', unknown: '◌' };

function Item({ label, state, text, title }) {
  return (
    <li className={`conn__item conn__item--${state}`} title={title}>
      <span className="conn__glyph" aria-hidden="true">
        {GLYPH[state]}
      </span>
      <span>{label}</span>
      <span className="conn__state">{text}</span>
    </li>
  );
}

export default function ConnectionStatus({ connection, connectionSince, elapsedMs, status }) {
  const defender =
    connection === 'live'
      ? { state: 'live', text: 'live' }
      : connection === 'down'
        ? { state: 'down', text: `down since ${formatClock(connectionSince)}` }
        : connection === 'reconnecting'
          ? { state: 'reconnecting', text: `reconnecting ${formatElapsed(elapsedMs)}` }
          : { state: 'unknown', text: 'connecting' };

  // With the Defender unreachable, what it last said about Redis and Hooks can't be trusted.
  const known = connection === 'live' && status;
  const redis = !known
    ? { state: 'unknown', text: '—' }
    : status.redis === 'ok'
      ? { state: 'live', text: 'live' }
      : { state: 'down', text: 'down' };

  const hookEvents = known ? status.hooks ?? [] : [];
  const hooks = !known
    ? { state: 'unknown', text: '—', title: '' }
    : hookEvents.length
      ? {
          state: 'live',
          text: 'events seen',
          title: hookEvents.map((h) => `Last event from ${h.inst} at ${formatClock(h.lastEventAt)}`).join('\n'),
        }
      : { state: 'unknown', text: 'no events yet', title: 'No events from CypherFy since the Defender started.' };

  return (
    <ul className="conn" aria-label="Connection status">
      <Item label="Defender" {...defender} />
      <Item label="Redis" {...redis} />
      <Item label="Hooks" {...hooks} />
    </ul>
  );
}

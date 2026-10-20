// Defender, Redis and Hooks status (BRIEF §7). The shape changes with the
// state (● live, ◔ reconnecting, ○ down), never only the colour.
//
// Hooks: live while a CypherFy instance's heartbeat key exists (the hooks
// refresh it every 10 s, even with no traffic); the tooltip says when each
// instance last saw real traffic.

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

  const instances = known ? status.hooks ?? [] : [];
  const alive = instances.filter((h) => h.alive);
  const describe = (h) => `${h.inst}: ${h.alive ? 'heartbeat OK' : 'no heartbeat'}, last event ${h.lastEventAt ? formatClock(h.lastEventAt) : 'none yet'}`;
  const hooks = !known
    ? { state: 'unknown', text: '—', title: '' }
    : alive.length
      ? { state: 'live', text: 'live', title: instances.map(describe).join('\n') }
      : instances.length
        ? { state: 'down', text: 'no heartbeat', title: instances.map(describe).join('\n') }
        : { state: 'unknown', text: 'not seen', title: 'No heartbeat from CypherFy hooks yet.' };

  return (
    <ul className="conn" aria-label="Connection status">
      <Item label="Defender" {...defender} />
      <Item label="Redis" {...redis} />
      <Item label="Hooks" {...hooks} />
    </ul>
  );
}

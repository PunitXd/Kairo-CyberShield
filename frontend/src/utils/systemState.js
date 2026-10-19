// What the console can trust right now (BRIEF §8 connection states). Plain
// functions so they can be unit-tested with node --test.
//
//   Defender reconnecting (< 10 s)  normal look, no band; actions paused
//   Defender unreachable (≥ 10 s)   warning band; values frozen, hatched, "as of"
//   Redis unreachable               critical band; blocks hidden, feed paused
//
// With the Defender unreachable nothing it last said about Redis can be
// trusted, so the Defender band wins.

const LOST_DEFENDER = (at) =>
  `Lost connection to Defender at ${at}. Blocks already in Redis still apply and still expire. Retrying every 5 s.`;
export const REDIS_DOWN_TEXT =
  'Protection paused: Redis is unreachable, so CypherFy is allowing all traffic. No blocks are being enforced.';

/** Values on screen are old: hatch them and stamp "as of". Only after 10 s, so venue Wi-Fi blips stay quiet. */
export const isStale = (connection) => connection === 'down';

export const isRedisDown = (connection, status) => connection === 'live' && status?.redis === 'down';

/** null when actions are allowed, else the reason (shown as the disabled control's tooltip). */
export const actionBlockedReason = (connection, status) => {
  if (connection !== 'live') return 'The Defender is unreachable; actions are paused';
  if (status?.redis === 'down') return 'Redis is unreachable, so blocks cannot be changed';
  return null;
};

/** The band under the top bar, or null. formatClock turns ms into "14:02:11". */
export const systemBanner = ({ connection, connectionSince, status }, formatClock) => {
  if (connection === 'down') return { kind: 'defender', tone: 'warning', text: LOST_DEFENDER(formatClock(connectionSince)) };
  if (isRedisDown(connection, status)) return { kind: 'redis', tone: 'critical', text: REDIS_DOWN_TEXT };
  return null;
};

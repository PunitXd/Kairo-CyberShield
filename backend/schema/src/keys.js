// Every Redis key Kairo uses (ARCH §8.1), Demo MVP subset, in one place so the
// hooks and the Defender can never disagree on a name. All keys live under
// `kairo:`; CypherFy's own keys stay under `cypherfy:`.
//
// Subjects must be 16-hex hashes: no event field is ever used in a key name
// unless it is one (ARCH §12), so raw identifiers can't end up in Redis.

import { SCOPES } from './event.js';

const HEX16 = /^[0-9a-f]{16}$/;
const FAMILIES = ['auth', 'room'];

const subject = (s) => {
  if (!HEX16.test(s)) throw new Error('Redis key subject must be a 16-hex hash');
  return s;
};
const scope = (s) => {
  if (!SCOPES.includes(s)) throw new Error(`unknown scope: ${String(s).slice(0, 16)}`);
  return s;
};
const family = (f) => {
  if (!FAMILIES.includes(f)) throw new Error(`unknown rule family: ${String(f).slice(0, 16)}`);
  return f;
};

export const KEYS = {
  /** Stream: hooks XADD, Defender XREADGROUP (group `defender`). */
  events: 'kairo:events',
  /** Sorted set of active automatic blocks: member `{scope}:{subject}`, score expiresAt. */
  blocksActive: 'kairo:blocks:active',
  /** Global kill switch: when set, every rule acts as shadow. */
  killswitch: 'kairo:killswitch',

  block: (sc, s) => `kairo:block:${scope(sc)}:${subject(s)}`,
  throttle: (sc, s) => `kairo:throttle:${scope(sc)}:${subject(s)}`,
  /** Throttle token gate: the hook allows one request per window via SET NX PX. */
  tokenGate: (sc, s) => `kairo:tb:${scope(sc)}:${subject(s)}`,
  allow: (s) => `kairo:allow:${subject(s)}`,
  strikes: (f, s) => `kairo:strikes:${family(f)}:${subject(s)}`,
  openIncident: (f, s) => `kairo:inc:open:${family(f)}:${subject(s)}`,
  /** Hooks heartbeat per backend instance; inst is sanitised, not a hash. */
  hooksHeartbeat: (inst) => `kairo:hb:hooks:${String(inst).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32)}`,
};

export const STREAM_MAXLEN = 100_000;
export const CONSUMER_GROUP = 'defender';

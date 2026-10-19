// Every Redis key Kairo uses (ARCH §8.1), Demo MVP subset, in one place so the
// hooks and the Defender can never disagree on a name. All keys live under
// `kairo:`; CypherFy's own keys stay under `cypherfy:`.
//
// Key subjects must be 16-hex hashes: no event field is ever used in a key name
// unless it is one (ARCH §12), so raw identifiers can't end up in Redis.

import { RULE_FAMILIES, SCOPES } from './event.constant.js';

export const STREAM_MAXLEN = 100_000;
export const CONSUMER_GROUP = 'defender';

const HEX16 = /^[0-9a-f]{16}$/;

const checkSubject = (s) => {
  if (!HEX16.test(s)) throw new Error('Redis key subject must be a 16-hex hash');
  return s;
};
const checkScope = (s) => {
  if (!SCOPES.includes(s)) throw new Error(`unknown scope: ${String(s).slice(0, 16)}`);
  return s;
};
const checkFamily = (f) => {
  if (!RULE_FAMILIES.includes(f)) throw new Error(`unknown rule family: ${String(f).slice(0, 16)}`);
  return f;
};

export const KEYS = {
  /** Stream: hooks XADD, Defender XREADGROUP (group `defender`). */
  events: 'kairo:events',
  /** Pub/sub: Defender → hooks commands (disconnect_socket, throttle_socket). */
  commands: 'kairo:commands',
  /** Sorted set of active automatic blocks: member `{scope}:{subject}`, score expiresAt. */
  blocksActive: 'kairo:blocks:active',
  /** Global kill switch: when set, every rule acts as shadow. */
  killswitch: 'kairo:killswitch',

  block: (scope, subject) => `kairo:block:${checkScope(scope)}:${checkSubject(subject)}`,
  throttle: (scope, subject) => `kairo:throttle:${checkScope(scope)}:${checkSubject(subject)}`,
  /** Throttle token gate: the hook allows one request per window via SET NX PX. */
  tokenGate: (scope, subject) => `kairo:tb:${checkScope(scope)}:${checkSubject(subject)}`,
  allow: (subject) => `kairo:allow:${checkSubject(subject)}`,
  strikes: (family, subject) => `kairo:strikes:${checkFamily(family)}:${checkSubject(subject)}`,
  openIncident: (family, subject) => `kairo:inc:open:${checkFamily(family)}:${checkSubject(subject)}`,
  /** Hooks heartbeat per backend instance; inst is sanitised, not a hash. */
  hooksHeartbeat: (inst) => `kairo:hb:hooks:${String(inst).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32)}`,
};

// flag (R2a → R2b plumbing, ARCH §8.1): mark that this source was recently
// guessing room codes, SET kairo:flag:roomguess:{ipHash} PX flagWindowMs. The
// hooks read it in denyJoin: while the flag exists, a join that hits a real
// room emits room.hit_while_flagged (R2b). Not a block — it is never listed in
// the Blocklist and never counts toward the active-block cap. Idempotent and
// never shortening, like the enforcement keys.

import { KEYS } from '../defender.constant.js';
import { setEnforcementKey } from '../utils/enforcementKey.js';

export const flagAction = {
  type: 'flag',
  apply: ({ redis, subject, ttlMs, value, now }) =>
    setEnforcementKey({ redis, key: KEYS.flagRoomGuess(subject), value: { ...value, kind: 'roomguess' }, ttlMs, now }),
};

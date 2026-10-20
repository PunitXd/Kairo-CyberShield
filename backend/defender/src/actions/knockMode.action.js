// knock_mode (R2b, ARCH §7.3): a flagged source hit a real room, so lock that
// room, SET kairo:knock:{codeHash} PX knockTtlMs. While it exists, the hooks'
// knockRequired() makes non-host, non-admitted joiners knock first (CypherFy's
// own lock behaviour). The key targets the ROOM (codeHash via params), while
// the incident and strikes stay on the source, like disconnect's socketId.
// The hook clamps nothing: if the room expires first, the key lingers against a
// dead room and expires harmlessly. Idempotent and never shortening.

import { KEYS } from '../defender.constant.js';
import { setEnforcementKey } from '../utils/enforcementKey.js';

export const knockModeAction = {
  type: 'knock_mode',
  apply: ({ redis, params, ttlMs, value, now }) => {
    if (!params?.codeHash) throw new Error('knock_mode needs a codeHash');
    return setEnforcementKey({ redis, key: KEYS.knock(params.codeHash), value: { actionId: value.actionId, until: now + ttlMs }, ttlMs, now });
  },
};

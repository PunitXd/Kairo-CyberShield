// throttle (scope auth): the hook lets one request per 5 s through while
// kairo:throttle:{scope}:{subject} exists, via its token gate key.

import { KEYS } from '../defender.constant.js';
import { setEnforcementKey } from '../utils/enforcementKey.js';

export const throttleAction = {
  type: 'throttle',
  apply: ({ redis, scope, subject, ttlMs, value, now }) =>
    setEnforcementKey({ redis, key: KEYS.throttle(scope, subject), value: { ...value, level: 'throttle' }, ttlMs, now }),
};

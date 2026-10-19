// throttle (scope auth): the hook lets one request per 5 s through while
// kairo:throttle:{scope}:{subject} exists, via its token gate key.

import { KEYS } from '../store/keys.js';
import { setEnforcementKey } from './keyAction.js';

export default {
  type: 'throttle',
  apply: ({ redis, scope, subject, ttlMs, value, now }) =>
    setEnforcementKey({ redis, key: KEYS.throttle(scope, subject), value: { ...value, level: 'throttle' }, ttlMs, now }),
};

// block: the hook answers 403 while kairo:block:{scope}:{subject} exists.
// Also tracked in kairo:blocks:active (score = expiresAt) for the active-block
// cap and the console.

import { KEYS } from '../defender.constant.js';
import { setEnforcementKey } from '../utils/enforcementKey.js';

export const blockAction = {
  type: 'block',
  async apply({ redis, scope, subject, ttlMs, value, now }) {
    const out = await setEnforcementKey({
      redis,
      key: KEYS.block(scope, subject),
      value: { ...value, level: 'block', expiresAt: now + ttlMs },
      ttlMs,
      now,
    });
    if (out.result === 'applied') await redis.zadd(KEYS.blocksActive, out.expiresAt, `${scope}:${subject}`);
    return out;
  },
};

// Safeguards (ARCH §7.2), checked in this exact order for every requested
// action, stopping at the first that applies:
//   1. KAIRO_ENV !== 'staging'          → skipped_shadow (production opt-in is v2)
//   2. kairo:killswitch set             → skipped_killswitch
//   3. rule mode 'shadow'               → skipped_shadow   ('off' never gets here)
//   4. kairo:allow:{subject} exists     → skipped_allowlist
//   5. active automatic blocks ≥ cap    → skipped_cap
// Then the TTL: fixed ttlMs from the rule, or the escalation ladder from
// kairo:strikes:{family}:{subject}; always clamped to maxBlockMs. No action
// ever goes out without a TTL.

import { KEYS } from '../store/keys.js';

export const checkSafeguards = async ({ redis, env, mode, subject, global, now }) => {
  if (env !== 'staging') return 'skipped_shadow';
  if (await redis.get(KEYS.killswitch)) return 'skipped_killswitch';
  if (mode === 'shadow') return 'skipped_shadow';
  if (await redis.exists(KEYS.allow(subject))) return 'skipped_allowlist';
  await redis.zremrangebyscore(KEYS.blocksActive, '-inf', now);
  if ((await redis.zcard(KEYS.blocksActive)) >= global.activeBlockCap) return 'skipped_cap';
  return null;
};

/** @returns {{ ttlMs: number, strike: number|null }} */
export const computeTtl = async ({ redis, request, family, subject, global }) => {
  if (request.ttlMs) return { ttlMs: Math.min(request.ttlMs, global.maxBlockMs), strike: null };
  const key = KEYS.strikes(family, subject);
  const strike = await redis.incr(key);
  if (strike === 1) await redis.pexpire(key, global.strikesTtlMs);
  const ladder = global.ladderMs;
  return { ttlMs: Math.min(ladder[Math.min(strike - 1, ladder.length - 1)], global.maxBlockMs), strike };
};

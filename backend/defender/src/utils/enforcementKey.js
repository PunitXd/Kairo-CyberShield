// Shared mechanism for TTL'd enforcement keys (ARCH §7.3, D4): the key's TTL
// is the expiry, so a block lifts on time even if the Defender is down.
// Idempotent and never shortening: if the key already has at least the new
// TTL left, it is left alone (`already_active`); otherwise it is (re)set.

export const setEnforcementKey = async ({ redis, key, value, ttlMs, now }) => {
  const pttl = await redis.pttl(key); // -2 missing, -1 no expiry (never written by us)
  if (pttl >= ttlMs) return { result: 'already_active', expiresAt: now + pttl };
  await redis.set(key, JSON.stringify(value), 'PX', ttlMs);
  return { result: 'applied', expiresAt: now + ttlMs };
};

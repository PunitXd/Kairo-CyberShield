// Identifier hashing (ARCH §5.4, D7). Raw IPs, emails, user ids and room codes
// are HMAC-SHA256'd inside the hooks and only the first 16 hex characters ever
// leave CypherFy. The Defender uses the same functions to hash an operator-typed
// IP for lookup. In CypherFy a room code is also the room's key, so treat raw
// codes like passwords: hash, then drop.
//
// Each kind of identifier gets its own prefix, so the same string hashed as an
// IP and as an email never produces the same value.

import { createHmac } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** `::ffff:10.0.0.5` and `10.0.0.5` are the same client; IPv6 is case-insensitive. */
export const normalizeIp = (ip) => {
  const trimmed = String(ip).trim().toLowerCase();
  const mapped = IPV4_MAPPED.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
};

/**
 * Build the hash functions for one secret (KAIRO_HASH_SECRET).
 * Throws if the secret is missing or short, so a misconfigured process fails
 * at startup instead of emitting weak hashes.
 */
export const createHasher = (secret) => {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`KAIRO_HASH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const hmac16 = (prefix, value) => createHmac('sha256', secret).update(prefix + value).digest('hex').slice(0, 16);

  return {
    ip: (ip) => hmac16('ip:', normalizeIp(ip)),
    account: (email) => hmac16('account:', String(email).trim().toLowerCase()),
    roomCode: (code) => hmac16('room:', String(code).trim().toUpperCase()),
    user: (userId) => hmac16('user:', String(userId)),
    session: (sessionId) => hmac16('session:', String(sessionId)),
  };
};

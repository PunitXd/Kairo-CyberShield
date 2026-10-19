// Target guard (ARCH §3.8): the attack scripts in this repo exist to exercise
// OUR OWN local demo stack. This refuses any target that is not localhost, a
// loopback address, an RFC 1918 / unique-local private address, or a hostname
// listed in attacks/targets.allow. cypherfy.in, *.cypherfy.in and any public
// address are rejected by checks that no flag can switch off.
//
// It resolves the hostname and checks every resolved address, so a name that
// points at a public host is refused even if the name itself looks harmless.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const FORBIDDEN_SUFFIXES = ['cypherfy.in']; // the live site and every subdomain — never overridable

const stripV6Brackets = (h) => h.replace(/^\[|\]$/g, '');
const unmapV4 = (ip) => {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return m ? m[1] : ip;
};

/** Loopback or a private (RFC 1918 / unique-local) address — the only hosts we attack. */
export const isPrivateAddress = (raw) => {
  const ip = unmapV4(String(raw).toLowerCase());
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    return false;
  }
  if (v === 6) {
    if (ip === '::1') return true; // loopback
    if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // fc00::/7 unique-local
    return false;
  }
  return false;
};

export const isForbiddenHost = (hostname) => {
  const h = stripV6Brackets(String(hostname).toLowerCase()).replace(/\.$/, '');
  return FORBIDDEN_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
};

/**
 * Resolve and validate a target URL. Returns { url, hostname, addresses } or
 * throws a TargetGuardError. The two hard rules — the forbidden-suffix check
 * and "every resolved address must be loopback/private" — are the whole guard
 * and no flag can switch them off.
 */
export const assertAllowedTarget = async (target) => {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new TargetGuardError(`not a valid URL: ${String(target).slice(0, 80)}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new TargetGuardError(`unsupported protocol: ${url.protocol}`);

  const hostname = stripV6Brackets(url.hostname.toLowerCase());
  if (isForbiddenHost(hostname)) {
    throw new TargetGuardError(`refusing to target ${hostname}: the live site and its subdomains are never allowed`);
  }

  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map((r) => r.address);
  if (!addresses.length) throw new TargetGuardError(`could not resolve ${hostname}`);

  const publicAddr = addresses.find((a) => !isPrivateAddress(a));
  if (publicAddr) {
    throw new TargetGuardError(`refusing to target ${hostname}: resolves to non-private address ${publicAddr}`);
  }

  return { url, hostname, addresses };
};

export class TargetGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TargetGuardError';
  }
}

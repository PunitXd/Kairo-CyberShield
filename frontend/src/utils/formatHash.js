// HashValue display (BRIEF §7): prefix + first 4 + … + last 2, e.g.
// "ip:3e9a…c1". Only ever formats a 16-hex hash: anything else renders as
// "<kind>:invalid", so a raw value can never be shown by mistake.

const HEX16 = /^[0-9a-f]{16}$/;

export const isHash = (value) => HEX16.test(String(value ?? ''));

export const formatHash = (kind, value) => (isHash(value) ? `${kind}:${value.slice(0, 4)}…${value.slice(-2)}` : `${kind}:invalid`);

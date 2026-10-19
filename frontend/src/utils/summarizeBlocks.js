// The Blocklist summary line (BRIEF §6 S4): "2 blocks · 1 throttle · cap 50 ·
// next expiry in 4:41". Pure, so it can be unit-tested.

import { formatCountdown } from './formatDuration.js';

export const summarizeBlocks = (blocks, now, cap = null) => {
  const active = blocks.filter((b) => b.expiresAt > now);
  const blockCount = active.filter((b) => b.level === 'block').length;
  const throttleCount = active.length - blockCount;
  const nextExpiryMs = active.length ? Math.min(...active.map((b) => b.expiresAt)) - now : null;

  const parts = [`${blockCount} block${blockCount === 1 ? '' : 's'}`, `${throttleCount} throttle${throttleCount === 1 ? '' : 's'}`];
  if (cap) parts.push(`cap ${cap}`);
  if (nextExpiryMs !== null) parts.push(`next expiry in ${formatCountdown(nextExpiryMs)}`);
  return { blockCount, throttleCount, nextExpiryMs, text: parts.join(' · ') };
};

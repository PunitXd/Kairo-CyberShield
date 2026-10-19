// Commands from the Defender to the hooks (ARCH §5.3), sent with
// PUBLISH kairo:commands. Every backend instance receives every command and
// validates it here before acting; the one that holds the socket acts and
// answers with a kairo.ack event. Missing a command is harmless: the TTL keys
// in Redis stay the source of truth.

import { z } from 'zod';

import { zSocketId, zUlid } from './event.schema.js';

const head = { v: z.literal(1), actionId: zUlid };

export const commandSchema = z.discriminatedUnion('op', [
  z.strictObject({ ...head, op: z.literal('disconnect_socket'), socketId: zSocketId }),
  z.strictObject({
    ...head,
    op: z.literal('throttle_socket'),
    socketId: zSocketId,
    maxPerSec: z.number().int().min(1).max(100),
    ttlMs: z.number().int().min(1000).max(600_000),
  }),
]);

/** Parse one pub/sub message → { success, data } or { success: false }. Never throws. */
export const parseCommand = (message) => {
  if (typeof message !== 'string' || message.length > 1024) return { success: false };
  try {
    return commandSchema.safeParse(JSON.parse(message));
  } catch {
    return { success: false };
  }
};

// Commands from the Defender (ARCH §5.3): SUBSCRIBE kairo:commands on a
// dedicated connection. Every instance gets every command; the one that holds
// the socket carries it out and emits kairo.ack, which the Defender uses for
// time-to-remediate on disconnects (ARCH §14.2). Invalid messages are dropped.

import { KEYS, parseCommand } from './schema/index.js';

export const createCommandService = ({ subscriber, layer, emitter, env, inst, log, now = Date.now }) => {
  const execute = (cmd) => {
    if (cmd.op === 'disconnect_socket') return layer.disconnect(cmd.socketId);
    if (cmd.op === 'throttle_socket') return layer.throttle(cmd.socketId, cmd.maxPerSec, cmd.ttlMs);
    return null;
  };

  /** Handle one pub/sub message; exported for tests. */
  const handle = (message) => {
    try {
      const parsed = parseCommand(message);
      if (!parsed.success) return log('kairo.command_invalid', {});
      const cmd = parsed.data;
      const src = execute(cmd);
      if (!src) return; // not on this instance
      emitter.emit({ ts: now(), type: 'kairo.ack', env, inst, src, ack: { actionId: cmd.actionId, ok: true } });
    } catch (err) {
      log('kairo.hook_error', { where: 'command', error: err?.message?.slice(0, 120) });
    }
  };

  const subscribe = () =>
    subscriber.subscribe(KEYS.commands).catch(() => log('kairo.redis_unavailable', { op: 'subscribe' }));

  return {
    handle,
    start() {
      subscriber.on('message', (channel, message) => {
        if (channel === KEYS.commands) handle(message);
      });
      // The hooks' client has no offline queue, so subscribe once connected;
      // ioredis resubscribes by itself after a reconnect.
      if (subscriber.status === 'ready') subscribe();
      else subscriber.once('ready', subscribe);
    },
    stop() {
      subscriber.disconnect?.();
    },
  };
};

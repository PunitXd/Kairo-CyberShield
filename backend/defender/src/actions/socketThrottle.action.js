// throttle (scope socket, R3a; ARCH §7.3): PUBLISH throttle_socket. The hooks
// keep an in-process token bucket for that socket, drop excess packets and
// send SLOW_DOWN once per second. The bucket is replaced, not stacked, so the
// rule firing again simply renews it. `sent` until the hooks ack it.

import { publishCommand } from './disconnect.action.js';

export const socketThrottleAction = {
  type: 'throttle',
  apply: ({ redis, params, ttlMs, value }) => {
    if (!params?.socketId) throw new Error('socket throttle needs a socketId');
    return publishCommand(redis, {
      actionId: value.actionId,
      op: 'throttle_socket',
      socketId: params.socketId,
      maxPerSec: params.maxPerSec,
      ttlMs,
    });
  },
};

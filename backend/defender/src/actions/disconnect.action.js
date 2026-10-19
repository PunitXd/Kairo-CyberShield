// disconnect (ARCH §7.3): PUBLISH disconnect_socket on kairo:commands. Every
// CypherFy instance receives it; the one holding the socket disconnects it and
// answers with kairo.ack. Until that ack arrives the action is `sent`; the ack
// service then marks it `applied`, so TTR is measured to the real disconnect
// (ARCH §14.2). A duplicate disconnect is a no-op, and no TTL or ladder strike
// is involved.

import { KEYS } from '../defender.constant.js';

export const publishCommand = async (redis, command) => {
  await redis.publish(KEYS.commands, JSON.stringify({ v: 1, ...command }));
  return { result: 'sent', expiresAt: null };
};

export const disconnectAction = {
  type: 'disconnect',
  needsTtl: false,
  apply: ({ redis, params, value }) => {
    if (!params?.socketId) throw new Error('disconnect needs a socketId');
    return publishCommand(redis, { actionId: value.actionId, op: 'disconnect_socket', socketId: params.socketId });
  },
};

// denyJoin(socket, code): the room_join guard for the socket path (ARCH §3.1).
// CypherFy calls it at the top of join_room and knock, before its own room
// lookup. When the source has a `room_join` block it answers with CypherFy's
// own ROOM_NOT_FOUND error (so existing clients need no change), emits
// room.join.denied, and returns true so the handler stops. That reply goes out
// unobserved, so a refused join is never counted again as a guess.
//
// Fail open: no layer, shadow mode, a Redis error or a timeout → false.

import { KEYS } from './schema/index.js';
import { withTimeout } from './redis.service.js';

const MAX_CODE_LENGTH = 64;

export const createJoinGuard = ({ layer, redis, emitter, hasher, env, inst, timeoutMs, log, now = Date.now }) => {
  const enforce = env !== 'production';

  return async function denyJoin(socket, code) {
    try {
      if (!enforce) return false;
      const state = layer.stateOf(socket?.id);
      if (!state) return false;
      const { src } = state;
      const [allow, block, killswitch] = await withTimeout(
        redis.mget(KEYS.allow(src.ipHash), KEYS.block('room_join', src.ipHash), KEYS.killswitch),
        timeoutMs
      );
      if (allow || killswitch || !block) return false;

      const codeHash = hasher.roomCode(typeof code === 'string' && code.length <= MAX_CODE_LENGTH ? code : '');
      state.rawEmit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found or expired' });
      emitter.emit({ ts: now(), type: 'room.join.denied', env, inst, src, room: { codeHash, kind: 'ephemeral', via: 'socket' } });
      return true;
    } catch (err) {
      if (/timeout|connection|stream|refused/i.test(String(err?.message))) log('kairo.redis_unavailable', { op: 'deny_join', failOpen: true });
      else log('kairo.hook_error', { where: 'deny_join', error: err?.message?.slice(0, 120) });
      return false;
    }
  };
};

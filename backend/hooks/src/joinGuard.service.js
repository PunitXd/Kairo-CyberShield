// The room_join guards for the socket path (ARCH §3.1), returned together:
//
//   denyJoin(socket, code)      called at the top of join_room and knock, before
//                               CypherFy's room lookup.
//   knockRequired(socket, room) called next to CypherFy's own isLocked check.
//
// denyJoin, in order:
//   1. allowlist / kill switch → allow (false)
//   2. R2b: the source is flagged (recently guessing) AND the code maps to a
//      real room (roomExists) → emit room.hit_while_flagged and reject with
//      CypherFy's own ROOM_NOT_FOUND, identical to a miss, so the attacker
//      cannot tell a hit from a miss. The Defender then locks the room.
//   3. R2a: a room_join block exists → emit room.join.denied and reject.
//   4. otherwise allow.
//
// knockRequired returns true while the room's kairo:knock key exists (R2b).
// CypherFy's surrounding host/admitted logic decides who is exempt.
//
// Fail open everywhere: no layer, shadow mode (production), a Redis error, a
// timeout or a roomExists error → allow / not-required.

import { KEYS } from './schema/index.js';
import { withTimeout } from './redis.service.js';

const MAX_CODE_LENGTH = 64;
const ROOM_EXISTS_TIMEOUT_MS = 250; // a DB lookup, looser than the 50 ms Redis budget

const isTransient = (err) => /timeout|connection|stream|refused/i.test(String(err?.message));

export const createJoinGuard = ({ layer, redis, emitter, hasher, env, inst, timeoutMs, log, roomExists = null, now = Date.now }) => {
  const enforce = env !== 'production';
  const codeHashOf = (code) => hasher.roomCode(typeof code === 'string' && code.length <= MAX_CODE_LENGTH ? code : '');

  const denyJoin = async (socket, code) => {
    try {
      if (!enforce) return false;
      const state = layer.stateOf(socket?.id);
      if (!state) return false;
      const { src } = state;
      const [allow, block, flag, killswitch] = await withTimeout(
        redis.mget(KEYS.allow(src.ipHash), KEYS.block('room_join', src.ipHash), KEYS.flagRoomGuess(src.ipHash), KEYS.killswitch),
        timeoutMs
      );
      if (allow || killswitch) return false;

      // R2b: a flagged source that lands on a real room (checked only when
      // flagged, so an unflagged join never hits the DB).
      if (flag && roomExists) {
        let exists = false;
        try {
          exists = Boolean(await withTimeout(Promise.resolve(roomExists(code)), ROOM_EXISTS_TIMEOUT_MS));
        } catch {
          exists = false; // fail open: no R2b, but R2a's block below still applies
        }
        if (exists) {
          state.rawEmit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found or expired' });
          emitter.emit({ ts: now(), type: 'room.hit_while_flagged', env, inst, src, room: { codeHash: codeHashOf(code), kind: 'ephemeral', via: 'socket' } });
          return true;
        }
      }

      if (!block) return false;
      state.rawEmit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found or expired' });
      emitter.emit({ ts: now(), type: 'room.join.denied', env, inst, src, room: { codeHash: codeHashOf(code), kind: 'ephemeral', via: 'socket' } });
      return true;
    } catch (err) {
      if (isTransient(err)) log('kairo.redis_unavailable', { op: 'deny_join', failOpen: true });
      else log('kairo.hook_error', { where: 'deny_join', error: err?.message?.slice(0, 120) });
      return false;
    }
  };

  const knockRequired = async (_socket, room) => {
    try {
      if (!enforce || !room?.code) return false;
      const knock = await withTimeout(redis.get(KEYS.knock(codeHashOf(room.code))), timeoutMs);
      return Boolean(knock);
    } catch (err) {
      if (isTransient(err)) log('kairo.redis_unavailable', { op: 'knock_required', failOpen: true });
      else log('kairo.hook_error', { where: 'knock_required', error: err?.message?.slice(0, 120) });
      return false; // fail open: a locked room stays open rather than blocking CypherFy
    }
  };

  return { denyJoin, knockRequired };
};

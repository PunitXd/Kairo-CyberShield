// Global kill switch (ARCH §7.2 safeguard 2, §8.1, PRD F8). While
// kairo:killswitch exists, the hooks let every request through and the
// Defender records "skipped_killswitch" instead of acting: Kairo keeps
// detecting but stops blocking. It has no TTL: only an operator turns it off.
// Every change is audited and pushed to the console straight away.

import { ulid } from 'ulid';

import { KEYS } from '../defender.constant.js';

const parse = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export const createKillSwitchService = ({ redis, mongo, bus, log, hasher = null, now = Date.now }) => ({
  async get() {
    const raw = await redis.get(KEYS.killswitch);
    return raw ? { on: true, since: parse(raw).at ?? null } : { on: false, since: null };
  },

  /** @returns {Promise<{ on: boolean, since: number|null, changed: boolean }>} */
  async set(on, { actorIp } = {}) {
    const before = await this.get();
    if (before.on === on) return { ...before, changed: false };

    const at = now();
    if (on) await redis.set(KEYS.killswitch, JSON.stringify({ by: 'operator', at })); // no PX: manual only
    else await redis.del(KEYS.killswitch);

    if (mongo) {
      try {
        await mongo.auditLog.insertOne({
          _id: ulid(),
          at: new Date(at),
          actor: 'operator',
          actorIpHash: actorIp && hasher ? hasher.ip(actorIp) : null,
          op: on ? 'killswitch_on' : 'killswitch_off',
          target: { killSwitch: true },
          before: { on: before.on, since: before.since },
          after: { on, since: on ? at : null },
        });
      } catch (err) {
        log?.error({ msg: 'mongo.write_failed', what: 'audit_log', error: err?.message?.slice(0, 200) });
      }
    }
    log?.warn({ msg: on ? 'operator.killswitch_on' : 'operator.killswitch_off' });
    bus?.emit('system.changed');
    return { on, since: on ? at : null, changed: true };
  },
});

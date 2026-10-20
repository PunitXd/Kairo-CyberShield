// Rules & safety (ARCH §9.2–9.3, PHASES Oct 21 #3): the rules with their
// live config and 7-day counts, mode changes from the console, and the
// config_versions history.
//
// Versions only ever go up and never repeat: at boot the Defender continues
// after the newest snapshot in config_versions (rules.json is read-only, so a
// mode change made before a restart is not in the file), and every change —
// a console mode change or a SIGHUP reload that differs — gets the next
// number and a snapshot { version, at, actor, global, rules }.

import { ulid } from 'ulid';

import { KEYS } from '../defender.constant.js';
import { rulesConfigSchema } from '../validators/rulesConfig.schema.js';

const DAY_MS = 24 * 3600_000;
const MODES = ['enforce', 'shadow', 'off'];
const SHOWN = new Set(['mode', 'threshold', 'windowMs']);

const sameContent = (a, b) => JSON.stringify([a.global, a.rules]) === JSON.stringify([b.global, b.rules]);

export class RuleNotFoundError extends Error {}

export const createRuleService = ({ configStore, rules, mongo, redis, bus = null, log, hasher = null, now = Date.now }) => {
  const versions = mongo?.configVersions ?? null;

  const latestSnapshot = async () => {
    try {
      return (await versions?.find({}).sort({ version: -1 }).limit(1).toArray())?.[0] ?? null;
    } catch (err) {
      log?.error({ msg: 'mongo.read_failed', what: 'config_versions', error: err?.message?.slice(0, 200) });
      return null;
    }
  };

  const snapshot = async (config, actor) => {
    try {
      await versions?.insertOne({ _id: ulid(), version: config.version, at: new Date(now()), actor, global: config.global, rules: config.rules });
    } catch (err) {
      log?.error({ msg: 'mongo.write_failed', what: 'config_versions', error: err?.message?.slice(0, 200) });
    }
  };

  const announce = (config) => {
    bus?.emit('config.updated', { configVersion: config.version });
    bus?.emit('system.changed'); // system.status carries the rule modes
  };

  const nextVersion = async () => Math.max(configStore.get().version, (await latestSnapshot())?.version ?? 0) + 1;

  return {
    /** Boot: continue the version history from config_versions. */
    async init() {
      const file = configStore.get();
      const latest = await latestSnapshot();
      if (latest && sameContent(file, latest)) {
        configStore.replace({ ...file, version: Math.max(file.version, latest.version) });
      } else {
        const version = latest && latest.version >= file.version ? latest.version + 1 : file.version;
        await snapshot(configStore.replace({ ...file, version }), 'rules.json');
      }
      return configStore.get().version;
    },

    /** SIGHUP: re-read rules.json; a different file becomes the next version. */
    async reloadFromFile() {
      const file = configStore.readFile();
      if (!file || sameContent(file, configStore.get())) return configStore.get().version;
      const version = Math.max(file.version, await nextVersion());
      const config = configStore.replace({ ...file, version });
      await snapshot(config, 'rules.json');
      log?.info({ msg: 'config.reloaded', configVersion: version });
      announce(config);
      return version;
    },

    /** The Rules screen: every rule, its config, allowed modes and 7-day counts, plus the safety numbers. */
    async list() {
      const config = configStore.get();
      const since = new Date(now() - 7 * DAY_MS);
      const fired = new Map();
      const fps = new Map();
      let countsOk = false;
      try {
        const rows = await mongo.incidents
          .aggregate([
            { $match: { detectedAt: { $gte: since } } },
            { $unwind: '$rulesFired' },
            { $group: { _id: '$rulesFired', fired: { $sum: 1 }, falsePositives: { $sum: { $cond: ['$falsePositive', 1, 0] } } } },
          ])
          .toArray();
        for (const r of rows) {
          fired.set(r._id, r.fired);
          fps.set(r._id, r.falsePositives);
        }
        countsOk = true;
      } catch (err) {
        log?.warn({ msg: 'rules.counts_failed', error: err?.message?.slice(0, 200) });
      }
      const items = rules.map((rule) => {
        const cfg = config.rules[rule.id] ?? null;
        const params = Object.fromEntries(Object.entries(cfg ?? {}).filter(([k]) => !SHOWN.has(k)));
        const allowedModes = cfg
          ? MODES.filter((mode) => rulesConfigSchema.safeParse({ ...config, rules: { ...config.rules, [rule.id]: { ...cfg, mode } } }).success)
          : [];
        return {
          id: rule.id,
          name: rule.name ?? rule.id,
          family: rule.family,
          ruleVersion: rule.version,
          mode: cfg?.mode ?? 'off',
          allowedModes,
          threshold: cfg?.threshold ?? null,
          windowMs: cfg?.windowMs ?? null,
          params,
          fired7d: countsOk ? fired.get(rule.id) ?? 0 : null,
          falsePositives7d: countsOk ? fps.get(rule.id) ?? 0 : null,
        };
      });

      let safety = { killSwitch: null, killSwitchSince: null, activeBlocks: null, activeBlockCap: config.global.activeBlockCap, allowlisted: null };
      try {
        const [ks, active, allowKeys] = await Promise.all([
          redis.get(KEYS.killswitch),
          redis.zcount(KEYS.blocksActive, now(), '+inf'),
          countKeys(redis, 'kairo:allow:*'),
        ]);
        let since = null;
        try {
          since = ks ? JSON.parse(ks).at ?? null : null;
        } catch {
          /* old value */
        }
        safety = { ...safety, killSwitch: Boolean(ks), killSwitchSince: since, activeBlocks: active, allowlisted: allowKeys };
      } catch (err) {
        log?.warn({ msg: 'rules.safety_failed', error: err?.message?.slice(0, 200) });
      }

      return { configVersion: config.version, configPath: configStore.path ?? null, safety, items };
    },

    /** PATCH /api/rules/:id { mode } → { configVersion, rule: { id, mode }, changed }. */
    async setMode(id, mode, { actorIp } = {}) {
      const before = configStore.get();
      const cfg = before.rules[id];
      if (!cfg || !rules.some((r) => r.id === id)) throw new RuleNotFoundError(`no rule ${id}`);
      if (cfg.mode === mode) return { configVersion: before.version, rule: { id, mode }, changed: false };

      const version = await nextVersion();
      // replace() validates: a mode the rule doesn't allow (R1c enforce) throws a ZodError → 400.
      const config = configStore.replace({ ...before, version, rules: { ...before.rules, [id]: { ...cfg, mode } } });
      await snapshot(config, 'operator');
      if (mongo?.auditLog) {
        try {
          await mongo.auditLog.insertOne({
            _id: ulid(),
            at: new Date(now()),
            actor: 'operator',
            actorIpHash: actorIp && hasher ? hasher.ip(actorIp) : null,
            op: 'rule_mode',
            target: { ruleId: id },
            before: { mode: cfg.mode, configVersion: before.version },
            after: { mode, configVersion: version },
          });
        } catch (err) {
          log?.error({ msg: 'mongo.write_failed', what: 'audit_log', error: err?.message?.slice(0, 200) });
        }
      }
      log?.warn({ msg: 'operator.rule_mode', rule: id, from: cfg.mode, to: mode, configVersion: version });
      announce(config);
      return { configVersion: version, rule: { id, mode }, changed: true };
    },
  };
};

/** Count keys matching a pattern with SCAN (never KEYS). */
const countKeys = async (redis, pattern) => {
  let cursor = '0';
  let n = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    n += keys.length;
  } while (cursor !== '0');
  return n;
};

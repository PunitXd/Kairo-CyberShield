// Active blocks and throttles, read straight from Redis (the TTL'd keys ARE
// the enforcement state, ARCH D4). SCAN, never KEYS, so a large keyspace can't
// stall Redis. Subjects are hashes; no raw identifier is ever read or returned.

const KEY_RE = /^kairo:(block|throttle):([a-z_]+):([0-9a-f]{16})$/;
const WATCH_INTERVAL_MS = 2000;

const scanKeys = async (redis, pattern) => {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return keys;
};

const parseValue = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/** One block/throttle item in the ARCH §9.2 `GET /api/blocks` shape. */
export const toBlockItem = ({ level, scope, subject, value = {}, ttlMs, now }) => ({
  scope,
  subject,
  level,
  rule: typeof value.rule === 'string' ? value.rule : null,
  ttlMs,
  expiresAt: now + ttlMs,
  actionId: value.actionId ?? null,
  incidentId: value.incidentId ?? null,
});

export const listBlocks = async (redis, { scope, now = Date.now() } = {}) => {
  const keys = [...(await scanKeys(redis, 'kairo:block:*')), ...(await scanKeys(redis, 'kairo:throttle:*'))];
  if (!keys.length) return [];
  const pipe = redis.pipeline();
  for (const k of keys) pipe.get(k).pttl(k);
  const results = await pipe.exec();

  const items = [];
  keys.forEach((key, i) => {
    const m = KEY_RE.exec(key);
    const [, level, keyScope, subject] = m ?? [];
    const raw = results[i * 2]?.[1];
    const ttlMs = results[i * 2 + 1]?.[1];
    if (!m || raw == null || !(ttlMs > 0)) return; // malformed, or expired between SCAN and GET
    if (scope && keyScope !== scope) return;
    items.push(toBlockItem({ level, scope: keyScope, subject, value: parseValue(raw), ttlMs, now }));
  });
  return items.sort((a, b) => b.expiresAt - a.expiresAt);
};

const itemKey = (item) => `${item.level}:${item.scope}:${item.subject}`;

/**
 * Blocks lift on their own when the Redis TTL runs out. Every 2 s this notices
 * keys that vanished and publishes `block.removed`, so the console drops them
 * without a page refresh. Additions are published by the remediation service
 * as they happen, so this only watches for removals.
 */
export const createBlockWatcher = ({ redis, bus, log, intervalMs = WATCH_INTERVAL_MS }) => {
  const known = new Map();
  let timer = null;

  bus.on('block.added', (item) => known.set(itemKey(item), item));
  bus.on('block.removed', (item) => known.delete(itemKey(item)));

  let failing = false; // warn once per Redis outage, not on every tick
  const tick = async () => {
    try {
      const current = new Map((await listBlocks(redis)).map((i) => [itemKey(i), i]));
      failing = false;
      for (const [key, item] of known) {
        if (!current.has(key)) bus.emit('block.removed', { ...item, ttlMs: 0, reason: 'expired' });
      }
      for (const [key, item] of current) known.set(key, item);
    } catch (err) {
      if (!failing) log?.warn({ msg: 'blocks.watch_failed', error: err?.message?.slice(0, 200) });
      failing = true;
    }
  };

  return {
    async start() {
      await tick();
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
    },
    tick,
  };
};

// Stream consumer (ARCH §5.1): consumer group `defender`, consumer `defender-1`.
// On start: create the group (ignore BUSYGROUP), drain this consumer's pending
// entries (id 0), then read new ones (>) with BLOCK 1000. Every entry is
// re-validated against the strict schema; events older than staleEventMs are
// skipped so a backlog after a restart can't trigger fresh blocks. Each batch
// is XACKed after processing, including invalid and stale entries.

import { fromStreamFields } from '@kairo/schema';
import { CONSUMER_GROUP, CONSUMER_NAME, KEYS } from '../store/keys.js';

const BATCH = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const createConsumer = ({ redis, runner, log, getStaleMs, now = Date.now }) => {
  let running = false;
  const stats = { processed: 0, invalid: 0, stale: 0, lastEventTs: null };

  const ensureGroup = async () => {
    try {
      await redis.xgroup('CREATE', KEYS.events, CONSUMER_GROUP, '$', 'MKSTREAM');
    } catch (err) {
      if (!String(err?.message).includes('BUSYGROUP')) throw err;
    }
  };

  const processEntries = async (entries) => {
    const ids = [];
    for (const [id, fields] of entries) {
      ids.push(id);
      if (!fields) continue; // trimmed by MAXLEN while pending
      const parsed = fromStreamFields(fields);
      if (!parsed.success) {
        stats.invalid++;
        const issues = (parsed.error?.issues ?? []).map((i) => `${i.path.join('.')}:${i.code}`).slice(0, 5);
        log.warn({ msg: 'event.invalid', id, issues: issues.length ? issues : [parsed.error?.message] });
        continue;
      }
      const event = parsed.data;
      if (now() - event.ts > getStaleMs()) {
        stats.stale++;
        continue;
      }
      try {
        await runner.handle(event);
        stats.processed++;
        stats.lastEventTs = event.ts;
      } catch (err) {
        log.error({ msg: 'event.failed', id, type: event.type, error: err?.message?.slice(0, 200) });
      }
    }
    if (ids.length) await redis.xack(KEYS.events, CONSUMER_GROUP, ...ids);
  };

  const read = async (id, block) => {
    const args = ['GROUP', CONSUMER_GROUP, CONSUMER_NAME, 'COUNT', BATCH];
    if (block) args.push('BLOCK', block);
    const res = await redis.xreadgroup(...args, 'STREAMS', KEYS.events, id);
    return res?.[0]?.[1] ?? [];
  };

  return {
    stats,
    async run() {
      running = true;
      await ensureGroup();

      // Anything delivered to us before a restart but never acknowledged.
      let pendingFrom = '0';
      while (running) {
        const entries = await read(pendingFrom, 0);
        if (!entries.length) break;
        await processEntries(entries);
        pendingFrom = entries.at(-1)[0];
      }

      while (running) {
        try {
          const entries = await read('>', 1000);
          if (entries.length) await processEntries(entries);
        } catch (err) {
          log.error({ msg: 'redis.consume_failed', error: err?.message?.slice(0, 200) });
          await sleep(1000);
        }
      }
    },
    stop() {
      running = false;
    },
  };
};

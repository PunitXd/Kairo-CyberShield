// Dev tool: pretty-print kairo:events live (ARCH §15).
//
//   node scripts/tailEvents.js            # new events only
//   node scripts/tailEvents.js --last 20  # the last 20, then follow
//
// Connects to the Compose Redis published on 127.0.0.1:6379 (override with
// KAIRO_TAIL_REDIS_URL). Every entry is re-validated against the schema, so an
// entry that doesn't match it is flagged instead of printed.

import Redis from 'ioredis';
import { KEYS, fromStreamFields } from 'kairo-schema';

const url = process.env.KAIRO_TAIL_REDIS_URL || 'redis://127.0.0.1:6379';
const lastIdx = process.argv.indexOf('--last');
const last = lastIdx > -1 ? Math.max(1, Number(process.argv[lastIdx + 1]) || 20) : 0;

const short = (h) => (h ? `${h.slice(0, 4)}…${h.slice(-2)}` : '-');

const detail = (e) => {
  switch (e.type) {
    case 'auth.fail':
    case 'auth.success':
      return `route=${e.auth.route} status=${e.auth.status} account:${short(e.auth.accountHash)}`;
    case 'room.join.invalid':
      return `room:${short(e.room.codeHash)} kind=${e.room.kind} via=${e.room.via}${e.room.error ? ` error=${e.room.error}` : ''}`;
    case 'http.denied':
      return `scope=${e.http.scope} rule=${e.http.rule}`;
    default:
      return '';
  }
};

const print = (id, fields) => {
  const parsed = fromStreamFields(fields);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? []).map((i) => `${i.path.join('.')}:${i.code}`).join(', ');
    console.log(`${id}  INVALID  ${issues || parsed.error?.message}`);
    return;
  }
  const e = parsed.data;
  const time = new Date(e.ts).toISOString().slice(11, 23);
  console.log(
    `${time}  ${e.type.padEnd(17)}  ip:${short(e.src.ipHash).padEnd(8)} ${e.src.authed ? 'authed' : 'anon  '}  ${detail(e)}`
  );
};

const redis = new Redis(url, { maxRetriesPerRequest: 1 });
redis.on('error', (err) => console.error(`tailEvents: redis ${err.message}`));
process.on('SIGINT', () => {
  redis.disconnect();
  process.exit(0);
});

console.log(`tailEvents: ${KEYS.events} on ${url.replace(/\/\/[^@]*@/, '//***@')}  (Ctrl+C to stop)`);

let cursor = '$';
if (last) {
  const recent = (await redis.xrevrange(KEYS.events, '+', '-', 'COUNT', last)).reverse();
  for (const [id, fields] of recent) print(id, fields);
  if (recent.length) cursor = recent.at(-1)[0];
}

for (;;) {
  const res = await redis.xread('BLOCK', 0, 'STREAMS', KEYS.events, cursor);
  for (const [, entries] of res ?? []) {
    for (const [id, fields] of entries) {
      print(id, fields);
      cursor = id;
    }
  }
}

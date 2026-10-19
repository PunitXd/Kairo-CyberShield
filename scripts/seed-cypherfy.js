// Seed the staging CypherFy database: 20 demo accounts and one ephemeral room.
//
//   npm run seed          (= node --env-file=.env scripts/seed-cypherfy.js)
//
// Runs in two halves. On the host it checks the inputs, then pipes this same
// file into the running cypherfy-backend container, where the second half
// seeds through CypherFy's own mongoose models (bcrypt, validators, defaults),
// so the data looks exactly like data CypherFy created itself. Idempotent:
// rerunning resets the demo passwords and the room's expiry.
//
// Never prints the password or the room code (the code is the room's key).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ACCOUNT_COUNT = 20;
const ROOM_TTL_SECONDS = 7 * 24 * 3600; // outlives the whole demo week
const ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/; // CypherFy's codeGenerator alphabet

const demoEmail = (i) => `demo${String(i).padStart(2, '0')}@kairo.test`;

if (process.env.KAIRO_SEED_IN_CONTAINER === '1') {
  await seedInsideBackend();
} else {
  runOnHost();
}

function runOnHost() {
  const { DEMO_PASSWORD, DEMO_ROOM_CODE } = process.env;
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) {
    fail('DEMO_PASSWORD must be set in .env (min 8 chars). Run with: npm run seed');
  }
  if (!ROOM_CODE_RE.test(DEMO_ROOM_CODE ?? '')) {
    fail('DEMO_ROOM_CODE must be 6 chars from ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  }

  const self = fileURLToPath(import.meta.url);
  const result = spawnSync(
    'docker',
    [
      'compose', 'exec', '-T',
      '-e', 'KAIRO_SEED_IN_CONTAINER=1',
      '-e', 'DEMO_PASSWORD',
      '-e', 'DEMO_ROOM_CODE',
      'cypherfy-backend',
      'node', '--input-type=module', '-',
    ],
    {
      cwd: path.resolve(path.dirname(self), '..'),
      input: readFileSync(self),
      stdio: ['pipe', 'inherit', 'inherit'],
      env: process.env,
    }
  );
  if (result.error) fail(`could not run docker compose: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

async function seedInsideBackend() {
  // Resolved inside the cypherfy-backend image (WORKDIR /app).
  const { default: mongoose } = await import('mongoose');
  const { DB_NAME } = await import('/app/src/constants.js');
  const { User } = await import('/app/src/models/user.model.js');
  const { Room } = await import('/app/src/models/room.model.js');

  const { DEMO_PASSWORD, DEMO_ROOM_CODE, MONGODB_URI } = process.env;
  if (!/@mongo:27017\//.test(MONGODB_URI ?? '')) {
    fail('refusing to seed: MONGODB_URI is not the local Compose mongo service');
  }

  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  try {
    let created = 0;
    for (let i = 1; i <= ACCOUNT_COUNT; i++) {
      const email = demoEmail(i);
      const handle = email.split('@')[0];
      let user = await User.findOne({ email });
      if (!user) {
        user = new User({ email, username: handle, displayName: `Demo ${String(i).padStart(2, '0')}` });
        created++;
      }
      await user.setPassword(DEMO_PASSWORD);
      user.isEmailVerified = true;
      user.refreshTokens = [];
      await user.save();
    }

    await Room.findOneAndUpdate(
      { code: DEMO_ROOM_CODE },
      {
        $set: {
          type: 'ephemeral',
          name: 'Kairo demo room',
          createdBy: 'KairoDemoHost',
          maxUsers: 10,
          isLocked: false,
          inactivityTTL: ROOM_TTL_SECONDS,
          // CypherFy stores the FUTURE expiry here (room.model.js TTL index).
          lastActivityAt: new Date(Date.now() + ROOM_TTL_SECONDS * 1000),
          currentUsers: [],
        },
      },
      { upsert: true, runValidators: true }
    );

    console.log(
      `seed: ${ACCOUNT_COUNT} demo accounts (${demoEmail(1)} .. ${demoEmail(ACCOUNT_COUNT)}, ${created} new), ` +
        `1 ephemeral room (code from DEMO_ROOM_CODE, expires in 7 days)`
    );
  } finally {
    await mongoose.disconnect();
  }
}

function fail(message) {
  console.error(`seed-cypherfy: ${message}`);
  process.exit(1);
}

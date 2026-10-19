# Kairo Shield

Self-healing DevSecOps for an end-to-end encrypted chat app.

Kairo Shield protects [CypherFy](https://cypherfy.in) at two stages:

- **Before deploy:** a GitHub Actions workflow (`kairo-shield.yml`, in the CypherFy repo) fails any push or PR that leaks a secret (Gitleaks) or adds a high or critical production dependency advisory (`npm audit`). The build runs only when both pass.
- **After deploy:** a thin hooks layer inside CypherFy's backend emits metadata-only security events to Redis. The **Defender** detects attacks with sliding-window rules and remediates them automatically: it throttles, then blocks, with every block expiring on its own. An operator console shows each detection and action live and can reverse any of them.

Detection rules in this build:

| Rule | Signal | Automatic response |
|---|---|---|
| R1a | 5 failed logins from one source in 60 s | Throttle logins for 5 min |
| R1b | 10 failed logins in 5 min (or R1a twice in 15 min) | Block logins: 5, then 15, then 60 min |
| R2a | 8 invalid ephemeral-room codes in 60 s | Block room lookups for 5 min |

**Metadata only.** Kairo never receives message text, ciphertext, keys, room codes, raw IPs or emails. Identifiers are HMAC-hashed inside the hooks before they leave CypherFy. The Privacy screen shows the event contract and a live sample.

**Fail open at runtime, fail closed in CI.** If Redis or the Defender is down, CypherFy keeps serving users and the console says protection is paused. If a scanner errors, the build fails.

## Layout

```
backend/
  defender/   detection + remediation service, console API, GitHub poller (serves the dashboard)
  hooks/      CypherFy middleware, vendored into CypherFy's backend/src/kairo/
  schema/     the zod event schema shared by hooks and Defender
frontend/     operator console (React + Vite)
attacks/      demo attack scripts (refuse any target that isn't local)
scripts/      seedCypherfy.js, demoReset.js, syncHooks.sh, tailEvents.js
infra/        Mongo init (separate users for CypherFy and Kairo)
env/          CypherFy staging env template
docker-compose.yml
```

## Setup (once)

You need Docker Desktop, Node 22, and the CypherFy repo checked out next to this one on branch `kairo`. That branch holds the four-line hook integration and the security workflow. Never point anything here at `main`: it auto-deploys to cypherfy.in.

```bash
git -C ../CypherFy switch kairo
```

1. Copy `.env.example` to `.env` and fill in the blanks. The file says how to generate each value. `.env` is gitignored, so never commit it.
   - `GITHUB_TOKEN` is optional. Create a fine-grained token with access to only `PunitXd/CypherFy`, **Actions: Read-only**, and a 30-day expiry. Without it, the Pipeline screen shows pass/fail but no findings.
2. Install dependencies and vendor the hooks into CypherFy (then commit them in CypherFy yourself):

   ```bash
   npm install
   ```

   ```bash
   npm run hooks:sync
   ```

3. Start the stack and seed the demo data (20 demo accounts and one ephemeral room):

   ```bash
   npm run stack:up
   ```

   ```bash
   npm run seed
   ```

| What | Where |
|---|---|
| Operator console (Defender) | http://localhost:7070 |
| CypherFy web (staging copy) | http://localhost:8080 |
| CypherFy API (staging copy) | http://localhost:8000 |

Everything binds to `127.0.0.1` by default. `CYPHERFY_BIND` in `.env` can expose the CypherFy web and API to a second laptop on the LAN; the console and Redis stay localhost-only. The staging stack uses its own Mongo and Redis in Compose, never production data.

## Before each judge

1. Reset (about 4 s; the limit is 15 s). It stops the Defender, clears Kairo's Redis keys, CypherFy's login backoff and the incidents, actions and audit log, reseeds CypherFy, and restarts the Defender. Pipeline runs are kept, so the Pipeline screen works without venue internet.

   ```bash
   npm run demo:reset
   ```

2. Start the legit user in its own terminal pane. It logs in as a real demo account every 2 s from the host, a different source from the attacker container:

   ```bash
   node --env-file=.env attacks/legitCheck.js --target http://localhost:8000
   ```

3. Browser at 110% zoom on http://localhost:7070, taking the left two-thirds of the screen. Terminal on the right: attack output on top, legit-check below.

## Demo script (6 minutes)

| Time | Do | What appears |
|---|---|---|
| 0:00 | **Overview**, quiet | `STAGING · enforce`, the **Metadata only** badge, "Kairo is watching 3 rules in Enforce" |
| 0:40 | **Pipeline**, click the **Blocked · secret · PR #1** card (newer runs may be listed above it) | `secrets` failed and open: `backend/src/config/storage.js:8 · aws-access-token · Critical · AKIA••••••••`; build skipped; **How to fix** says to rotate the key; **View on GitHub** |
| 1:40 | Run the brute force (below) | Feed row appears as **Throttled · auth (R1a)** within seconds, then turns **Blocked · auth (R1b)** in place; countdowns; Detect/Remediate p95 in milliseconds; legit-check stays `200 OK` |
| 3:10 | Run the room guessing (below) | New row **Blocked · rooms (R2a)** about 2 s after the attack starts |
| 4:10 | Click the R1b row, then **Blocklist → Unblock** on the auth row | Drawer: timeline R1a → R1b with detect/remediate times, evidence, **Fields received**. Unblock: toast with **Undo**; the rooms block stays; the incident becomes **Resolved · manually** |
| 5:10 | **Privacy** | Received / Never received; live sample of the last 20 events: hashes and counts only |

Attack commands (they run in the `attacker` container, a separate source from the host):

```bash
docker compose --profile attack run --rm attacker node attacks/bruteforce.js --target http://cypherfy-backend:8000
```

```bash
docker compose --profile attack run --rm attacker node attacks/roomGuess.js --target http://cypherfy-backend:8000
```

The attack scripts refuse any target that isn't localhost, a private LAN address or a Compose service name. Never run them against anything but this local stack.

### Showing a pipeline run live

Any push to the `kairo` or `demo/leaked-secret` branch of CypherFy runs the workflow. The Defender polls GitHub every 15 s, so a finished run shows up on the Pipeline screen within about 20 s. Never merge the `demo/leaked-secret` PR. Its key is fake and non-functional, but the branch exists only to be blocked.

## If something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| Amber band "Lost connection to Defender…" | The Defender has been unreachable for 10 s; values are frozen and stamped "as of" | `docker compose start kairo-defender`. The page recovers by itself |
| Red band "Protection paused: Redis is unreachable…" | CypherFy is failing open: users can still log in, but nothing is enforced | `docker compose start redis`. Blocks with time left come back from AOF |
| Pipeline says "Can't reach GitHub" | No internet, or the token is wrong | The stored runs still show. Fallback: the run page on GitHub |
| The attack never reaches 403 | CypherFy's own login backoff is hiding Kairo, or old state is left | `npm run demo:reset` |

## Tests

```bash
npm test
```

Runs the Defender, hooks, schema, attacks, dashboard and reset-script suites. They include the emitter allowlist test, which fails if any event could carry message content, keys, room codes, raw IPs or emails.

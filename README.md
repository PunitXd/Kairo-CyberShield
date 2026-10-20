# Kairo Shield

Self-healing DevSecOps for an end-to-end encrypted chat app.

Kairo Shield protects [CypherFy](https://cypherfy.in) at two stages:

- **Before deploy:** `kairo-init` scans the repo and generates a GitHub Actions workflow (`kairo-shield.yml`) and a Gitleaks config for it. The workflow fails any push or PR that leaks a secret (Gitleaks), adds a high or critical production dependency advisory (`npm audit`), or builds a container image with a fixable high or critical CVE (Trivy). The build runs only when every check passes.
- **After deploy:** a thin hooks layer inside CypherFy's backend emits metadata-only security events to Redis. The **Defender** detects attacks with sliding-window rules and remediates them automatically: it throttles, blocks, disconnects, locks a room into knock mode, or rolls back a bad deploy. Every block expires on its own. An operator console shows each detection and action live and can reverse any of them.

Detection rules in this build (thresholds live in `backend/defender/config/rules.json`):

| Rule | Signal | Automatic response |
|---|---|---|
| R1a | 5 failed logins from one source in 60 s | Throttle logins for 5 min (1 request per 5 s) |
| R1b | 10 failed logins in 5 min, or R1a twice in 15 min | Block logins: 5, then 15, then 60 min |
| R1c | CypherFy's own login limiter answered 429 | Shadow record only (CypherFy already acts) |
| R2a | 8 invalid room codes in 60 s (HTTP or socket) | Block room joins (5 / 15 / 60 min); cut the socket |
| R2b | A source R2a flagged hits a real room | Knock mode on that room for 10 min |
| R3a | Socket event flood, 30 weighted events in 10 s (WebRTC signalling counts ¼) | Slow the socket down to 3 events/s |
| R3b | 100 events in 10 s, or R3a/R3d fired 3 times in 5 min | Disconnect, block new sockets from the source |
| R3c | 20 new connections in 60 s (reconnects collapsed) | Block new sockets for 10 min |
| R3d | 10 malformed payloads in 60 s | Disconnect the socket (counts toward R3b) |
| R4 | After a deploy: 60 s grace, then 3 failed health probes in a row | Roll back to the last healthy version, at most once per 30 min |

**Metadata only.** Kairo never receives message text, ciphertext, keys, room codes, raw IPs or emails. Identifiers are HMAC-hashed inside the hooks before they leave CypherFy. The Privacy screen shows the event contract and a live sample.

**Fail open at runtime, fail closed in CI.** If Redis or the Defender is down, CypherFy keeps serving users and the console says protection is paused. If a scanner errors, the build fails.

**Every automatic action has a reason, a countdown and an undo.** Rules can be switched between Enforce, Shadow and Off on the Rules screen; a global kill switch stops all enforcement at once; a source can be allowlisted for up to 24 h.

## Layout

```
backend/
  defender/   detection + remediation service, console API, GitHub and health pollers (serves the dashboard)
  hooks/      CypherFy middleware, vendored into CypherFy's backend/src/kairo/
  schema/     the zod event schema shared by hooks and Defender
frontend/     operator console (React + Vite)
pipeline/     kairo-init: generates kairo-shield.yml and .gitleaks.toml for a repo
attacks/      demo attack scripts (refuse any target that isn't local)
scripts/      seedCypherfy.js, demoReset.js, deploy.sh, deployer.js, syncHooks.sh, tailEvents.js
infra/        Mongo init (separate users for CypherFy and Kairo)
env/          CypherFy staging env template
docker-compose.yml
```

## Setup (once)

You need Docker Desktop, Node 22, and the CypherFy repo checked out next to this one on branch `kairo`. That branch holds the hook integration and the security workflow. Never point anything here at `main`: it auto-deploys to cypherfy.in.

```bash
git -C ../CypherFy switch kairo
```

1. Copy `.env.example` to `.env` and fill in the blanks. The file says how to generate each value, including `KAIRO_DEPLOY_TOKEN`. `.env` is gitignored, so never commit it.
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

4. Record one known-good deployment, so R4 has a healthy version to roll back to. Start the deployer in its own terminal (it stays running), then deploy the current `kairo` commit. It turns **Healthy** on the Deployments screen after the 60 s grace.

   ```bash
   npm run deployer
   ```

   ```bash
   bash scripts/deploy.sh $(git -C ../CypherFy rev-parse --short=12 kairo)
   ```

| What | Where |
|---|---|
| Operator console (Defender) | http://localhost:7070 |
| CypherFy web (staging copy) | http://localhost:8080 |
| CypherFy API (staging copy) | http://localhost:8000 |

Everything binds to `127.0.0.1` by default. `CYPHERFY_BIND` in `.env` can expose the CypherFy web and API to a second laptop on the LAN; the console and Redis stay localhost-only. The staging stack uses its own Mongo and Redis in Compose, never production data.

### Generating the pipeline

`kairo-init` detects npm projects, Dockerfiles, Flutter projects and example env files, and writes the workflow and Gitleaks config. Actions are pinned to commit SHAs and the Gitleaks and Trivy binaries to checksums (`pipeline/versions.json`). It never allowlists anything on its own: existing allowlist entries and their reasons are kept, other example files are only reported.

```bash
node pipeline/bin/kairoInit.js ../CypherFy --dry-run
```

Without `--dry-run` it writes the files; a file that would change needs `--force`. It prints the branch-protection checks to set on GitHub by hand.

## Before each judge

1. Reset (about 5 s; the limit is 15 s). It stops the Defender, clears Kairo's Redis keys (blocks, knock mode, the rollback budget and freeze), CypherFy's login backoff and the incidents, actions, audit log and allowlist, reseeds CypherFy, and restarts the Defender. Pipeline runs and deployments are kept, so those screens work without venue internet.

   ```bash
   npm run demo:reset
   ```

2. Check the deployer is running (`npm run deployer` in its own terminal). Without it a rollback fails after 15 s with a Critical incident.
3. Start the legit user in its own terminal pane. It logs in as a real demo account every 2 s from the host, a different source from the attacker container:

   ```bash
   node --env-file=.env attacks/legitCheck.js --target http://localhost:8000
   ```

4. Open the seeded room as its host in one browser (CypherFy web, http://localhost:8080), and keep a second browser (or a phone on the LAN) ready to join it during the room-guessing step.
5. Console at 110% zoom on http://localhost:7070, taking the left two-thirds of the screen. Terminal on the right: attack output on top, legit-check below.

## Demo script (about 7 minutes)

The rollback takes about two minutes, so it starts first and the screen comes back to it later.

| Time | Do | What appears |
|---|---|---|
| 0:00 | **Overview**, normal use; start `badDeploy.sh` (below) in the background | Live traffic chart and activity stream moving; `STAGING · enforce`; **Metadata only** badge; status line "Watching cypherfy-backend-1 · … · 9 rules in Enforce" |
| 0:30 | `kairoInit.js --dry-run`, then **Pipeline**: the `demo/leaked-secret` and `demo/vuln-dep` cards | Detected projects and the generated workflow. **Blocked · secret** with `AKIA••••••••` and **How to fix: rotate the key**; **Blocked · dependency** with `lodash · high`; a clean `kairo` run passing all six jobs including the Trivy image scans |
| 1:30 | Run the brute force (below) | The failed-logins line climbs to its dashed threshold of 5; **R1a · Throttled** then **R1b · Blocked** markers; the feed row turns Throttled → Blocked in place; Detect/Remediate p95 in milliseconds; legit-check stays `200 OK` |
| 2:30 | Run the seeded room guessing (below); then join the room from the second browser | Socket cut twice, **Blocked · rooms (R2a)**, then a **Critical R2b** incident; the second browser gets CypherFy's own "Room is locked — knock to request entry" |
| 3:30 | Run the socket flood (below) | **Slowed → Disconnected → Blocked · sockets (R3a/R3b)**; the logged-in chat in the first browser keeps working |
| 4:20 | **Deployments** | `bfd6897` **Rolled back → 46d9e5b**, recovered in about 10 s; **Automatic rollback used · next allowed in 28:…**; the R4 incident in the feed |
| 5:00 | Open the R1 incident; **Mark false positive** → allowlist; **Blocklist → Unblock**, then **Undo**; **Rules**: switch R1b to Shadow and back | Drawer: attempts-over-time chart with the threshold and action markers, timeline with detect/remediate times, **Fields received**. Every action is reversible |
| 6:00 | **Privacy** | Received / Never received; the attacks' raw events as hashes and counts only. Close with the roadmap |

Attack commands. They run in the `attacker` container, a separate source from the host, and refuse any target that isn't this local stack:

```bash
docker compose --profile attack run --rm attacker node attacks/bruteforce.js --target http://cypherfy-backend:8000
```

```bash
bash attacks/roomGuessSeeded.sh
```

```bash
docker compose --profile attack run --rm attacker node attacks/flood.js --mode events --target http://cypherfy-backend:8000
```

```bash
bash attacks/badDeploy.sh
```

`roomGuessSeeded.sh` sends the seeded room's real code as the 40th guess; the code is the room's key, so it is read from `.env` and never printed. `badDeploy.sh` builds CypherFy's `demo/bad-deploy` branch (its health check answers 500) and deploys it through `scripts/deploy.sh`. A second bad deploy within 30 minutes is not rolled back: automation freezes and a Critical "Rollback paused" band appears.

### Showing a pipeline run live

Any push to `kairo`, `demo/leaked-secret` or `demo/vuln-dep` in CypherFy runs the workflow; a full run takes about 90 s. The Defender polls GitHub every 15 s, so a finished run shows up on the Pipeline screen within about 20 s. Never merge the demo branches: they exist only to be blocked or rolled back.

## If something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| Amber band "Lost connection to Defender…" | The Defender has been unreachable for 10 s; values are frozen and stamped "as of" | `docker compose start kairo-defender`. The page recovers by itself |
| Red band "Protection paused: Redis is unreachable…" | CypherFy is failing open: users can still log in (slowly: CypherFy's own login waits on Redis), but nothing is enforced | `docker compose start redis`. Blocks with time left come back from AOF |
| Red band "Rollback paused…" | R4 stopped itself: the budget was used, the previous version was unhealthy too, or the deployer didn't answer | **Deployments → Roll back** to restore the last healthy version, then **Clear the freeze**. `npm run demo:reset` also clears it |
| A deploy shows "Failed to start" / "the deployer did not answer" | `scripts/deployer.js` isn't running | `npm run deployer`, then deploy again |
| Amber band "No events from CypherFy for 60 s…" | CypherFy answers its health check but the hooks aren't sending a heartbeat | Check that `backend/src/kairo/` is in the running CypherFy image (`npm run hooks:sync`, rebuild) |
| Pipeline says "Can't reach GitHub" | No internet, or the token is wrong | The stored runs still show. Fallback: the run page on GitHub |
| The attack never reaches 403 | CypherFy's own login backoff is hiding Kairo, or old state is left | `npm run demo:reset` |

## Tests

```bash
npm test
```

Runs the Defender, hooks, schema, attacks, `kairo-init`, dashboard and script suites. They include the emitter allowlist test, which fails if any event could carry message content, keys, room codes, raw IPs or emails.

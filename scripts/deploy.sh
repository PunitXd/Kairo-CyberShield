#!/usr/bin/env bash
# Deploy one CypherFy commit to the local demo stack (ARCH §11.4, PHASES Oct 22 #3).
#
#   bash scripts/deploy.sh <git-sha>
#
# 1. Builds cypherfy-backend:<sha> from `git archive` of that commit in
#    $CYPHERFY_PATH, never from the working tree, so the image is exactly the
#    commit (uncommitted edits can't leak in).
# 2. POSTs {tag} to the Defender with the deploy token (sent through curl's
#    stdin config, so it never shows up in `ps`). The Defender records the
#    deployment, picks the last healthy one as the rollback target, and tells
#    the host deployer (npm run deployer) to switch the container.
# Prints no secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA="${1:-}"
if [[ ! "$SHA" =~ ^[a-f0-9]{7,40}$ ]]; then
  echo "usage: bash scripts/deploy.sh <git-sha>   (7–40 hex characters)" >&2
  exit 2
fi

# Read one KEY=value from .env without executing it.
env_value() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//"; }

CYPHERFY_PATH="${CYPHERFY_PATH:-$(env_value CYPHERFY_PATH)}"
CYPHERFY_PATH="${CYPHERFY_PATH/#\~/$HOME}"
TOKEN="${KAIRO_DEPLOY_TOKEN:-$(env_value KAIRO_DEPLOY_TOKEN)}"
DEFENDER_URL="${DEFENDER_URL:-http://127.0.0.1:7070}"

if [[ -z "$CYPHERFY_PATH" || ! -d "$CYPHERFY_PATH/.git" ]]; then
  echo "deploy: CYPHERFY_PATH is not a git checkout (set it in .env)" >&2
  exit 2
fi
if [[ ${#TOKEN} -lt 32 ]]; then
  echo "deploy: KAIRO_DEPLOY_TOKEN (≥ 32 characters) is not set in .env" >&2
  exit 2
fi

FULL="$(git -C "$CYPHERFY_PATH" rev-parse --verify --quiet "${SHA}^{commit}")" || {
  echo "deploy: $SHA is not a commit in $CYPHERFY_PATH" >&2
  exit 2
}
TAG="${FULL:0:12}"
SUBJECT="$(git -C "$CYPHERFY_PATH" log -1 --format=%s "$FULL" | cut -c1-72)"

echo "deploy: building cypherfy-backend:$TAG  ($SUBJECT)"
git -C "$CYPHERFY_PATH" archive --format=tar "$FULL:backend" | docker build --quiet -t "cypherfy-backend:$TAG" - >/dev/null
echo "deploy: built; asking the Defender to deploy it"

printf 'header = "X-Kairo-Deploy-Token: %s"\n' "$TOKEN" |
  curl --silent --show-error --fail-with-body --max-time 10 -K - \
    -H 'content-type: application/json' \
    -X POST --data "{\"tag\":\"$TAG\"}" \
    "$DEFENDER_URL/api/deployments"
echo
echo "deploy: requested. The deployer switches the container; watch the Deployments screen."

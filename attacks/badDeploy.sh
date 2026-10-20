#!/usr/bin/env bash
# R4 demo driver (PHASES Oct 22 #3, ARCH §11.4): deploy CypherFy's
# `demo/bad-deploy` branch, whose /api/v1/health answers 500, to OUR OWN local
# demo stack. After the 60 s grace and 3 failed probes Kairo's R4 rolls back to
# the last healthy deployment, once per 30 min.
#
#   bash attacks/badDeploy.sh
#
# Needs the host deployer running (npm run deployer) and a healthy deployment
# to roll back to (bash scripts/deploy.sh <kairo sha> once, beforehand). Only
# ever touches the local Compose stack through scripts/deploy.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CYPHERFY_PATH="${CYPHERFY_PATH:-$(grep -E '^CYPHERFY_PATH=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//")}"
CYPHERFY_PATH="${CYPHERFY_PATH/#\~/$HOME}"

SHA="$(git -C "$CYPHERFY_PATH" rev-parse --verify --quiet 'demo/bad-deploy^{commit}')" || {
  echo "badDeploy: branch demo/bad-deploy not found in $CYPHERFY_PATH" >&2
  exit 2
}
echo "badDeploy: deploying demo/bad-deploy (its health route returns 500)"
exec bash "$ROOT/scripts/deploy.sh" "${SHA:0:12}"

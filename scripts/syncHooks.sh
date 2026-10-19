#!/usr/bin/env bash
# Vendor the hooks into CypherFy (ARCH §11.5).
#
#   scripts/syncHooks.sh   (or: npm run hooks:sync)
#
# Copies backend/hooks/src/ (except its schema symlink) and backend/schema/src/ into
# $CYPHERFY_PATH/backend/src/kairo/ (schema under kairo/schema/), replacing what
# is there, and stamps kairo/VERSION with this repo's commit. Refuses to run
# unless CypherFy is on branch `kairo`: main auto-deploys to cypherfy.in.
# Commits nothing; review and commit in CypherFy yourself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${CYPHERFY_PATH:-}" && -f "$ROOT/.env" ]]; then
  CYPHERFY_PATH="$(grep -E '^CYPHERFY_PATH=' "$ROOT/.env" | tail -1 | cut -d= -f2-)"
fi
: "${CYPHERFY_PATH:?set CYPHERFY_PATH (in .env or the environment)}"
# Relative paths in .env are relative to this repo, like in docker-compose.yml.
[[ "$CYPHERFY_PATH" = /* ]] || CYPHERFY_PATH="$ROOT/$CYPHERFY_PATH"

BACKEND="$CYPHERFY_PATH/backend"
[[ -f "$BACKEND/src/app.js" ]] || { echo "syncHooks: $BACKEND/src/app.js not found; is CYPHERFY_PATH right?" >&2; exit 1; }

BRANCH="$(git -C "$CYPHERFY_PATH" rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "kairo" ]]; then
  echo "syncHooks: CypherFy is on '$BRANCH'; switch to branch 'kairo' first (never sync into main)" >&2
  exit 1
fi

DEST="$BACKEND/src/kairo"
rm -rf "$DEST"
mkdir -p "$DEST/schema"
rsync -a --exclude "/schema" "$ROOT/backend/hooks/src/" "$DEST/"
rsync -a "$ROOT/backend/schema/src/" "$DEST/schema/"

VERSION="$(git -C "$ROOT" rev-parse --short HEAD)"
if [[ -n "$(git -C "$ROOT" status --porcelain -- backend/hooks backend/schema)" ]]; then
  VERSION="$VERSION-dirty"
fi
printf '%s\n' "$VERSION" > "$DEST/VERSION"

echo "syncHooks: kairo@$VERSION -> $DEST"
( cd "$DEST" && find . -type f | sort | sed 's#^\./#  #' )

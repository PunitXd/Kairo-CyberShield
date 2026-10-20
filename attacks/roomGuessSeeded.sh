#!/usr/bin/env bash
# R2a + R2b demo driver (PHASES §4, 2:30): guess room codes over a socket from
# the attacker container, sending the seeded room's real code as attempt 40,
# so Kairo blocks the source and locks that room into knock mode.
#
#   bash attacks/roomGuessSeeded.sh
#
# Reads only DEMO_ROOM_CODE from .env (nothing else is sourced) and passes it
# to the container through the environment, so the room code (the room's key)
# never appears in the command line, `ps` or shell history. roomGuess.js never
# prints it either. Targets the local Compose stack only.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_ROOM_CODE="$(grep -E '^DEMO_ROOM_CODE=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//")"
if [[ ! "$DEMO_ROOM_CODE" =~ ^[A-Z2-9]{6}$ ]]; then
  echo "roomGuessSeeded: DEMO_ROOM_CODE is not set in .env (run npm run seed)" >&2
  exit 2
fi
export DEMO_ROOM_CODE
cd "$ROOT"
exec docker compose --profile attack run --rm -e DEMO_ROOM_CODE attacker \
  node attacks/roomGuess.js --via socket --seed-at 40 --target http://cypherfy-backend:8000

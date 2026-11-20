#!/bin/sh
# Everything worth running before a commit: the stress pass (every class, relic, skill, affix, boss and map event, drawn),
# the seed check (replay and script), the README's counts and the server tests. Usage: tools/check.sh [stress minutes] [seed-check minutes]
DIR="$(dirname "$0")"
FAIL=0
node "$DIR/stress.js" "${1:-1}" | tail -1 | grep -q "no page errors" && echo "stress        ok" || { echo "stress        FAILED"; FAIL=1; }
node "$DIR/determinism.js" "${2:-4}" | tail -1 | grep -q "replays its seed exactly" && echo "seed check    ok" || { echo "seed check    FAILED"; FAIL=1; }
node "$DIR/counts.js" >/dev/null 2>&1 && echo "readme counts ok" || { echo "readme counts FAILED (run node tools/counts.js)"; FAIL=1; }
if command -v bun >/dev/null 2>&1; then
  bun test "$DIR" 2>&1 | grep -q " 0 fail" && echo "server tests  ok" || { echo "server tests  FAILED"; FAIL=1; }
else
  echo "server tests  skipped (bun is not installed)"
fi
exit $FAIL

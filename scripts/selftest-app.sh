#!/bin/bash
# Opens a test document in build/Leading.app with LEADING_SELFTEST=1: the app
# sends its own View and Find menu commands through its window, checks what the
# page and the saved settings did, prints PASS/FAIL lines and quits.
# Your reading settings are restored afterwards.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp)"
pkill -x Leading; sleep 0.5
# Work on copies: the test appends to its file to check reloading.
TMP="$(mktemp -d)"
cp "$ROOT/web/test/fixtures/prose.md" "$ROOT/web/test/fixtures/tables.md" "$TMP/"
open --env LEADING_SELFTEST=1 --stdout "$OUT" --stderr /dev/null -a "$ROOT/build/Leading.app" \
  "$TMP/tables.md" --args -ApplePersistenceIgnoreState YES
sleep 1.5
open -a "$ROOT/build/Leading.app" "$TMP/prose.md"
sleep 2
# The checks take about half a minute; allow twice that.
for _ in $(seq 1 120); do pgrep -x Leading >/dev/null || break; sleep 0.5; done
cat "$OUT"
! grep -q FAIL "$OUT"

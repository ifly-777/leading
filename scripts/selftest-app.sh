#!/bin/bash
# Opens a test document in build/Leading.app with LEADING_SELFTEST=1: the app
# sends its own View and Find menu commands through its window, checks what the
# page and the saved settings did, prints PASS/FAIL lines and quits.
# Your reading settings are restored afterwards.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp)"
pkill -x Leading; sleep 0.5
open --env LEADING_SELFTEST=1 --stdout "$OUT" --stderr /dev/null -a "$ROOT/build/Leading.app" \
  "$ROOT/web/test/fixtures/prose.md" --args -ApplePersistenceIgnoreState YES
sleep 2
for _ in $(seq 1 60); do pgrep -x Leading >/dev/null || break; sleep 0.5; done
cat "$OUT"
! grep -q FAIL "$OUT"

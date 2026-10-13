#!/bin/bash
# Measures how long Leading takes to put a document's first text on screen.
#   cold: the app is not running; time from process start to first text
#   warm: the app is already running; time from the file arriving to first text
# The app records each paint when LEADING_TIMING_LOG is set (see OpenTiming.swift).
#
#   scripts/measure-open.sh [runs]        (default 8; build/Leading.app must exist)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Leading.app"
RUNS="${1:-8}"
WORK="$(mktemp -d)"
LOG="$WORK/timing.jsonl"
FIX="$ROOT/web/test/fixtures"
[ -f "$FIX/stress-5mb.md" ] || node "$ROOT/web/scripts/gen-stress.mjs" >/dev/null

# Count only first-paint records; the log also holds "loaded" records.
lines() { [ -f "$LOG" ] && grep -c sinceOpenMs "$LOG" || true; }
wait_for_line() { # wait until the log has more than $1 lines (10 s at most)
  for _ in $(seq 1 100); do [ "$(lines)" -gt "$1" ] && return 0; sleep 0.1; done; echo "  (timed out)" >&2; return 1
}
open_in_app() { # copy the file under a fresh name, so each open is a new document
  local copy="$WORK/$RANDOM-$(basename "$1")"
  cp "$1" "$copy"
  open -a "$APP" "$copy" --args -ApplePersistenceIgnoreState YES
}

echo "Leading open times, $RUNS runs each ($(sysctl -n machdep.cpu.brand_string))"
for f in prose.md tables.md stress-5mb.md; do
  : > "$LOG"
  for _ in $(seq 1 "$RUNS"); do
    pkill -x Leading; sleep 0.8
    n=$(lines)
    copy="$WORK/$RANDOM-$f"; cp "$FIX/$f" "$copy"
    # -ApplePersistenceIgnoreState: do not reopen last session's windows, so only this file is timed.
    open -n --env LEADING_TIMING_LOG="$LOG" -a "$APP" "$copy" --args -ApplePersistenceIgnoreState YES
    wait_for_line "$n"
    sleep 0.5
  done
  cold=$(python3 -c "import json,statistics as s;v=[json.loads(l)['sinceLaunchMs'] for l in open('$LOG') if 'sinceLaunchMs' in l and 'sinceOpenMs' in l];print(f'median {s.median(v):5.0f} ms   worst {max(v):5.0f} ms') if v else print('no data')")
  # Warm: the app is running from the last cold run.
  : > "$LOG.warm"
  for _ in $(seq 1 "$RUNS"); do
    n=$(lines); open_in_app "$FIX/$f"; wait_for_line "$n"; grep sinceOpenMs "$LOG" | tail -1 >> "$LOG.warm"; sleep 0.6
  done
  warm=$(python3 -c "import json,statistics as s;v=[json.loads(l)['sinceOpenMs'] for l in open('$LOG.warm')];print(f'median {s.median(v):5.0f} ms   worst {max(v):5.0f} ms') if v else print('no data')")
  printf "%-15s cold: %s\n%-15s warm: %s\n" "$f" "$cold" "" "$warm"
done
pkill -x Leading
rm -rf "$WORK"

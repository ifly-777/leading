# Shared by screenshots.sh and make-video.sh: has build/Leading.app draw its
# own window into a PNG (LEADING_SNAPSHOT; see Snapshot.swift).
#
# Each picture comes from a separate instance with its reading settings held
# in memory, so your preferences, open windows and a running Leading are left
# alone. The documents opened are taken off File › Open Recent afterwards.
APP="$ROOT/build/Leading.app"
[ -d "$APP" ] || { echo "build the app first: scripts/build-app.sh" >&2; exit 1; }

RECENTS="$HOME/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/io.github.ifly-777.leading.sfl3"
SAVED_RECENTS="$(mktemp)"
HAD_RECENTS=0
if [ -f "$RECENTS" ]; then cp "$RECENTS" "$SAVED_RECENTS"; HAD_RECENTS=1; fi
restore_recents() {
  if [ "$HAD_RECENTS" = 1 ]; then cp "$SAVED_RECENTS" "$RECENTS"; else rm -f "$RECENTS"; fi
  rm -f "$SAVED_RECENTS"
}
trap restore_recents EXIT

snapshot() { # out.png document settings-json size [edit] [page commands, comma-separated]
  local out="$1" doc="$2" settings="$3" size="$4" edit="${5:-0}" commands="${6:-}"
  echo "› $(basename "$out" .png)"
  rm -f "$out"
  # -n: a separate instance, so a Leading you have open is not disturbed.
  open -n -W --env LEADING_SNAPSHOT="$out" --env LEADING_SNAPSHOT_SETTINGS="$settings" \
    --env LEADING_SNAPSHOT_SIZE="$size" --env LEADING_SNAPSHOT_EDIT="$edit" --env LEADING_SNAPSHOT_COMMANDS="$commands" \
    -a "$APP" "$doc" --args -ApplePersistenceIgnoreState YES
  [ -f "$out" ] || { echo "✗ no picture for $out" >&2; exit 1; }
}

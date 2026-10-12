#!/bin/bash
# Downloads Sparkle (the update framework) as published by its authors and
# checks it against the checksum in Sparkle's own Package.swift for this
# version, then unpacks it to mac/Vendor (not committed). Used locally and by CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=2.10.0
SHA256=17e28312b8e18ab7cdbbe09a6fb28cc55a5479ec6c371dbc07cdecd2a14fd959
DEST="$ROOT/mac/Vendor"
[ -d "$DEST/Sparkle.xcframework" ] && [ "$(cat "$DEST/.sparkle-version" 2>/dev/null)" = "$VERSION" ] && exit 0
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/sparkle.zip" "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-for-Swift-Package-Manager.zip"
echo "$SHA256  $TMP/sparkle.zip" | shasum -a 256 -c --quiet
rm -rf "$DEST" && mkdir -p "$DEST"
ditto -x -k "$TMP/sparkle.zip" "$DEST"
echo "$VERSION" > "$DEST/.sparkle-version"
rm -rf "$TMP"
echo "✓ Sparkle $VERSION in mac/Vendor"

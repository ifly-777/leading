#!/bin/bash
# Signs the app. Without a paid Apple account this is an "ad-hoc" signature,
# which Apple Silicon requires before it will run any code at all.
#
# The designated requirement is pinned to the bundle identifier. By default an
# ad-hoc signature identifies the app by a hash of this exact build, so macOS
# would treat every update as a different app: privacy permissions (such as
# folder access for local images) would be asked again, and an updater could
# refuse the new build. Pinning it lets each build be recognised as Leading.
#
# If a Developer ID ever becomes available, set SIGNING_IDENTITY and the same
# script switches to a hardened-runtime, timestamped signature for notarisation.
set -euo pipefail
APP="$1"
BUNDLE_ID="$2"
IDENTITY="${SIGNING_IDENTITY:--}"

# Sign anything nested first (frameworks, helpers), innermost outwards.
if [ -d "$APP/Contents/Frameworks" ]; then
  find "$APP/Contents/Frameworks" -depth \( -name "*.framework" -o -name "*.xpc" -o -name "*.app" -o -perm -111 -type f \) -print0 |
    while IFS= read -r -d '' item; do
      if [ "$IDENTITY" = "-" ]; then codesign --force --sign - "$item" 2>/dev/null || true
      else codesign --force --options runtime --timestamp --sign "$IDENTITY" "$item" 2>/dev/null || true; fi
    done
fi

if [ "$IDENTITY" = "-" ]; then
  codesign --force --sign - --identifier "$BUNDLE_ID" \
    --requirements "=designated => identifier \"$BUNDLE_ID\"" "$APP"
else
  codesign --force --options runtime --timestamp --sign "$IDENTITY" --identifier "$BUNDLE_ID" "$APP"
fi
codesign --verify --strict --verbose=1 "$APP"
codesign --display --requirements - "$APP" 2>&1 | grep designated

#!/bin/bash
# Signs the app. Without a paid Apple account this is an "ad-hoc" signature,
# which Apple Silicon requires before it will run any code at all.
#
# The ad-hoc signature's designated requirement is left as macOS makes it: a
# hash of this exact build, which nobody else can reproduce. An earlier plan
# pinned it to the bundle identifier, so that macOS would treat each update as
# the same app and not ask again for folder access (for local images). The
# Stage 2 update spike showed why that is unsafe: Sparkle accepts an update
# whose code signature matches the old app's even when its EdDSA signature
# does not (that is how it supports key rotation), and an identifier-only
# requirement is matched by anyone's app with the same identifier. With the
# default requirement, every update must carry a valid EdDSA signature.
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
  codesign --force --sign - --identifier "$BUNDLE_ID" "$APP"
else
  codesign --force --options runtime --timestamp --sign "$IDENTITY" --identifier "$BUNDLE_ID" "$APP"
fi
codesign --verify --strict --verbose=1 "$APP"
codesign --display --requirements - "$APP" 2>&1 | grep designated

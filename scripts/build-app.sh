#!/bin/bash
# Builds Leading.app: the web page, the Swift app (Apple Silicon + Intel in one
# binary), the bundle around them, and a signature. Used locally and by CI.
#
#   scripts/build-app.sh            release build in build/Leading.app
#   SIGNING_IDENTITY="Developer ID Application: …" scripts/build-app.sh
#                                   (later, if a paid account appears; see sign.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/mac/Config/app.env"
# Allow a one-off version override (the update spike builds two versions).
VERSION="${VERSION_OVERRIDE:-$VERSION}"
BUILD="${BUILD_OVERRIDE:-$BUILD}"
# Use the full Xcode even if xcode-select still points at the Command Line Tools.
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app ]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi

OUT="$ROOT/build"
APP="$OUT/$APP_NAME.app"
ARCHS="${ARCHS:-arm64 x86_64}"

echo "› Web page"
( cd "$ROOT/web" && { [ -d node_modules ] || npm ci; } && npm run build --silent )

echo "› Sparkle"
"$ROOT/scripts/fetch-sparkle.sh"

echo "› Swift app ($ARCHS)"
ARCH_FLAGS=""
for a in $ARCHS; do ARCH_FLAGS="$ARCH_FLAGS --arch $a"; done
( cd "$ROOT/mac" && swift build -c release $ARCH_FLAGS --product "$APP_NAME" )
BIN_DIR="$(cd "$ROOT/mac" && swift build -c release $ARCH_FLAGS --show-bin-path)"

echo "› Bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Licenses"
cp "$BIN_DIR/$APP_NAME" "$APP/Contents/MacOS/$APP_NAME"
# The update public key: from the environment (the update spike), else the repository file.
SPARKLE_PUBLIC_KEY="${SPARKLE_PUBLIC_KEY:-$(grep -v '^#' "$ROOT/mac/Config/sparkle-public-key.txt" | head -1)}"
sed -e "s/@APP_NAME@/$APP_NAME/g" -e "s/@BUNDLE_ID@/$BUNDLE_ID/g" -e "s/@VERSION@/$VERSION/g" \
    -e "s/@BUILD@/$BUILD/g" -e "s/@MIN_MACOS@/$MIN_MACOS/g" -e "s|@SPARKLE_FEED@|$SPARKLE_FEED|g" \
    -e "s|@SPARKLE_PUBLIC_KEY@|$SPARKLE_PUBLIC_KEY|g" "$ROOT/mac/Resources/Info.plist.in" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
printf 'APPL????' > "$APP/Contents/PkgInfo"
cp -R "$ROOT/web/dist" "$APP/Contents/Resources/web"
# Sparkle, the update framework (only ever active if the reader turns updates on).
mkdir -p "$APP/Contents/Frameworks"
SPARKLE="$ROOT/mac/Vendor/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
ditto "$SPARKLE" "$APP/Contents/Frameworks/Sparkle.framework"
cp "$ROOT/mac/Resources/Credits.html" "$APP/Contents/Resources/"
# Opened (as a copy) on the first launch and from Help › Welcome to Leading.
cp "$ROOT/mac/Resources/Welcome to Leading.md" "$APP/Contents/Resources/"
# The icon: layers made in the Icon Composer format, which macOS 26 lights and
# tints itself; actool (part of Xcode) also writes a flat copy for older places.
xcrun actool "$ROOT/mac/Resources/AppIcon.icon" --compile "$APP/Contents/Resources" --platform macosx \
  --minimum-deployment-target "$MIN_MACOS" --app-icon AppIcon --output-partial-info-plist "$OUT/icon-info.plist" >/dev/null
# Each bundled font's licence travels with it, as the OFL requires.
cp "$ROOT/LICENSE" "$APP/Contents/Resources/Licenses/Leading-MIT.txt"
cp "$ROOT/mac/Vendor/LICENSE" "$APP/Contents/Resources/Licenses/Sparkle-LICENSE.txt"
for d in "$ROOT"/web/fonts/*/; do
  name="$(basename "$d")"
  for f in "$d"OFL.txt "$d"LICENSE.md; do [ -f "$f" ] && cp "$f" "$APP/Contents/Resources/Licenses/$name-$(basename "$f")"; done
done

echo "› Sign"
"$ROOT/scripts/sign.sh" "$APP" "$BUNDLE_ID"
echo "✓ $APP ($(lipo -archs "$APP/Contents/MacOS/$APP_NAME"))"

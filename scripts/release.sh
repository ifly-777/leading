#!/bin/bash
# Makes a release of the version in mac/Config/app.env, on this Mac:
#
#   build/Leading-<v>.dmg   what people download (with the "If macOS blocks Leading" guide)
#   build/Leading-<v>.zip   what Sparkle downloads to update an installed copy
#   build/appcast.xml       the update feed, naming the zip and its EdDSA signature
#
# Releases are made here, not on CI, because the update-signing key lives only
# in this Mac's login Keychain (macOS may ask once to let sign_update use it).
# Losing that key means installed copies can never update themselves again, so
# keep a backup: mac/Vendor/bin/generate_keys --account io.github.ifly-777.leading -x <file>
# and store the file in a password manager.
#
#   scripts/release.sh            build and sign everything, publish nothing
#   scripts/release.sh --publish  then tag, push main and the tag, and publish a GitHub release
#
# Before releasing: raise VERSION and BUILD in app.env, and write the notes in
# docs/releases/<version>.md (they appear in Sparkle's update window and on GitHub).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/mac/Config/app.env"
KEY_ACCOUNT="$BUNDLE_ID"
REPO="ifly-777/leading"
NOTES="$ROOT/docs/releases/$VERSION.md"
TAG="v$VERSION"
OUT="$ROOT/build"
DMG="$OUT/$APP_NAME-$VERSION.dmg"
ZIP="$OUT/$APP_NAME-$VERSION.zip"
FEED="$OUT/appcast.xml"
PUBLISH="${1:-}"

fail() { echo "✗ $*" >&2; exit 1; }
[ -f "$NOTES" ] || fail "write the release notes first: docs/releases/$VERSION.md"
if [ "$PUBLISH" = "--publish" ]; then
  [ -z "$(git -C "$ROOT" status --porcelain)" ] || fail "commit or stash changes first; a release is built from a clean tree"
  ! git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "$TAG already exists; raise VERSION and BUILD in app.env"
  # The release is pushed with main, so it must be main, and GitHub's main must
  # be part of it. Checked now, before the build, rather than failing at the end.
  [ "$(git -C "$ROOT" branch --show-current)" = main ] || fail "release from main"
  git -C "$ROOT" fetch -q origin main
  git -C "$ROOT" merge-base --is-ancestor origin/main HEAD || fail "GitHub's main has commits this one lacks; pull them first"
fi

echo "› Build $APP_NAME $VERSION ($BUILD), Apple Silicon and Intel"
ARCHS="arm64 x86_64" "$ROOT/scripts/build-app.sh" >/dev/null
# The update key compiled into the app must be the one in the Keychain, or no
# copy of this release could ever accept an update.
KEYCHAIN_PUB="$("$ROOT/mac/Vendor/bin/generate_keys" --account "$KEY_ACCOUNT" -p)"
APP_PUB="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$OUT/$APP_NAME.app/Contents/Info.plist")"
[ "$KEYCHAIN_PUB" = "$APP_PUB" ] || fail "the app's update key ($APP_PUB) is not the Keychain's ($KEYCHAIN_PUB)"
"$ROOT/scripts/make-dmg.sh"

echo "› Update archive and feed"
rm -f "$ZIP"
( cd "$OUT" && ditto -c -k --sequesterRsrc --keepParent "$APP_NAME.app" "$ZIP" )
SIG="$("$ROOT/mac/Vendor/bin/sign_update" --account "$KEY_ACCOUNT" -p "$ZIP")"
# Check the signature against the public key in the app, as Sparkle will.
"$ROOT/mac/Vendor/bin/sign_update" --account "$KEY_ACCOUNT" --verify "$ZIP" "$SIG" >/dev/null || fail "the update signature does not verify"
LEN="$(stat -f%z "$ZIP")"
URL="https://github.com/$REPO/releases/download/$TAG/$(basename "$ZIP")"
# The feed holds only the newest release: Sparkle needs nothing older, and
# each release carries its own copy (the app reads releases/latest/download/appcast.xml).
# The notes are Markdown, which Sparkle shows formatted; CDATA keeps them verbatim.
NOTES_TEXT="$(sed 's/]]>/]]]]><![CDATA[>/g' "$NOTES")"
cat > "$FEED" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>$APP_NAME</title>
    <link>https://github.com/$REPO</link>
    <item>
      <title>$APP_NAME $VERSION</title>
      <pubDate>$(LC_ALL=C date -u "+%a, %d %b %Y %H:%M:%S +0000")</pubDate>
      <sparkle:version>$BUILD</sparkle:version>
      <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$MIN_MACOS</sparkle:minimumSystemVersion>
      <description sparkle:format="markdown"><![CDATA[$NOTES_TEXT]]></description>
      <enclosure url="$URL" length="$LEN" type="application/octet-stream" sparkle:edSignature="$SIG"/>
    </item>
  </channel>
</rss>
XML
xmllint --noout "$FEED"
echo "✓ $DMG"
echo "✓ $ZIP (EdDSA signature verified)"
echo "✓ $FEED"

if [ "$PUBLISH" != "--publish" ]; then
  echo
  echo "Nothing published. To publish this release: scripts/release.sh --publish"
  exit 0
fi

echo "› Publish $TAG"
git -C "$ROOT" tag -a "$TAG" -m "$APP_NAME $VERSION"
# Main and the tag together, or neither: GitHub's main should never lag a release.
# If the push fails, drop the tag so the next run can make it again.
git -C "$ROOT" push --atomic origin main "$TAG" || { git -C "$ROOT" tag -d "$TAG" >/dev/null; fail "push failed; nothing was published"; }
# Marked latest, so releases/latest/download/appcast.xml now serves this feed.
gh release create "$TAG" "$DMG" "$ZIP" "$FEED" --repo "$REPO" --title "$APP_NAME $VERSION" --notes-file "$NOTES" --latest
echo "✓ https://github.com/$REPO/releases/tag/$TAG"

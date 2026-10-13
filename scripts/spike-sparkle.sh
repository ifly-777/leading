#!/bin/bash
# The Stage 2 update spike: can an ad-hoc-signed Leading update itself with
# Sparkle, and does the updated app arrive without a quarantine flag (so
# Gatekeeper's "Open Anyway" is never needed again)?
#
# Everything stays on this Mac: a throwaway EdDSA key in a temporary folder
# (never the keychain), two builds (A = 0.2.0, B = 0.2.1), and B's update
# feed served from 127.0.0.1. A checks the feed at launch, downloads B,
# verifies it, installs it over itself and relaunches.
# Modes: MODE=honest (default; must update), MODE=tamper (wrong signature;
# must be refused), MODE=foreign (attacker's app and key; must be refused).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PORT=8765
SERVER=""
# Stop the feed server and the app however the script ends (a server left
# running would serve a stale feed to the next run).
# Sparkle records its state in the app's preferences, which the real Leading
# on this Mac shares (same bundle identifier); remove it so the spike never
# leaves update checks switched on.
# Only this test's own copies are stopped (by path): a Leading the user has
# open stays open. Sparkle keeps its state in the preferences the real Leading
# shares (same bundle identifier), and the copy it relaunches may write there
# too, so the user's preferences are saved first and put back exactly.
PREFS="$WORK/prefs-before.plist"
defaults export io.github.ifly-777.leading "$PREFS" 2>/dev/null || PREFS=""
stop_test_copies() { pkill -f "$WORK/" 2>/dev/null || true; }
cleanup() {
  [ -n "$SERVER" ] && kill "$SERVER" 2>/dev/null
  stop_test_copies
  # Sparkle relaunches the updated app a moment after installing; catch a late one.
  sleep 2; stop_test_copies
  if [ -n "$PREFS" ]; then
    defaults delete io.github.ifly-777.leading 2>/dev/null || true
    defaults import io.github.ifly-777.leading "$PREFS"
  else
    defaults delete io.github.ifly-777.leading 2>/dev/null || true
  fi
  # build/Leading.app is now a marked test build; remove it so it is never installed by mistake.
  if [ "$(/usr/libexec/PlistBuddy -c 'Print :LeadingTestBuild' "$ROOT/build/Leading.app/Contents/Info.plist" 2>/dev/null)" = "true" ]; then
    rm -rf "$ROOT/build/Leading.app"
    echo "(build/Leading.app was a test build and has been removed; run scripts/build-app.sh for a real one)"
  fi
}
trap cleanup EXIT
if lsof -ti tcp:$PORT >/dev/null 2>&1; then echo "port $PORT is busy; stop whatever is using it first" >&2; exit 1; fi

echo "› Throwaway signing key"
openssl genpkey -algorithm ed25519 -out "$WORK/key.pem" 2>/dev/null
# Sparkle wants the raw 32-byte public key, base64-encoded.
PUB="$(openssl pkey -in "$WORK/key.pem" -pubout -outform DER | tail -c 32 | base64)"

build() { # version build-number destination
  TEST_BUILD=1 VERSION_OVERRIDE="$1" BUILD_OVERRIDE="$2" SPARKLE_PUBLIC_KEY="$PUB" ARCHS=arm64 "$ROOT/scripts/build-app.sh" >/dev/null
  rm -rf "$3"; mkdir -p "$(dirname "$3")"; ditto "$ROOT/build/Leading.app" "$3"
}
echo "› Build A (0.2.0) and B (0.2.1)"
build 0.2.0 20 "$WORK/install/Leading.app"
# MODE=foreign: B is built and correctly signed with someone else's key, as an
# attacker who could replace the download would do. It must be refused.
if [ "${MODE:-honest}" = "foreign" ]; then
  echo "  (MODE=foreign: B carries and is signed with a different key; must be refused)"
  openssl genpkey -algorithm ed25519 -out "$WORK/attacker.pem" 2>/dev/null
  ATTACKER_PUB="$(openssl pkey -in "$WORK/attacker.pem" -pubout -outform DER | tail -c 32 | base64)"
  PUB_A="$PUB"; PUB="$ATTACKER_PUB"; build 0.2.1 21 "$WORK/B/Leading.app"; PUB="$PUB_A"
  cp "$WORK/attacker.pem" "$WORK/key-for-B.pem"
else
  build 0.2.1 21 "$WORK/B/Leading.app"
  cp "$WORK/key.pem" "$WORK/key-for-B.pem"
fi

echo "› Sign B's archive and write the feed"
mkdir -p "$WORK/feed"
( cd "$WORK/B" && ditto -c -k --keepParent Leading.app "$WORK/feed/Leading-0.2.1.zip" )
SIG="$(openssl pkeyutl -sign -inkey "$WORK/key-for-B.pem" -rawin -in "$WORK/feed/Leading-0.2.1.zip" | base64)"
if [ "${MODE:-honest}" = "tamper" ]; then
  # Security check: sign with a different key. Sparkle must refuse the update.
  echo "  (MODE=tamper: signing B's download with the wrong key; must be refused)"
  openssl genpkey -algorithm ed25519 -out "$WORK/wrong.pem" 2>/dev/null
  SIG="$(openssl pkeyutl -sign -inkey "$WORK/wrong.pem" -rawin -in "$WORK/feed/Leading-0.2.1.zip" | base64)"
fi
LEN="$(stat -f%z "$WORK/feed/Leading-0.2.1.zip")"
cat > "$WORK/feed/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel><title>Leading</title>
    <item>
      <title>Leading 0.2.1</title>
      <sparkle:version>21</sparkle:version>
      <sparkle:shortVersionString>0.2.1</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>26.0</sparkle:minimumSystemVersion>
      <enclosure url="http://127.0.0.1:$PORT/Leading-0.2.1.zip" length="$LEN" type="application/octet-stream" sparkle:edSignature="$SIG"/>
    </item>
  </channel>
</rss>
XML
python3 -m http.server $PORT --bind 127.0.0.1 --directory "$WORK/feed" >/dev/null 2>&1 &
SERVER=$!
sleep 1

# A is not marked quarantined here: a quarantined app launched this way stops
# at Gatekeeper's prompt. What matters is whether B arrives with the flag;
# Sparkle downloads it itself, and the result below shows.
echo "› Run A; it should find, verify, install B and relaunch"
LEADING_SPIKE_UPDATE=1 LEADING_FEED_URL="http://127.0.0.1:$PORT/appcast.xml" \
  "$WORK/install/Leading.app/Contents/MacOS/Leading" -ApplePersistenceIgnoreState YES > "$WORK/a.log" 2>&1 &
for _ in $(seq 1 ${WAIT:-60}); do
  v="$(defaults read "$WORK/install/Leading.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)"
  [ "$v" = "0.2.1" ] && break; sleep 1
done
sleep 3
echo
echo "Result"
echo "  installed version:  $(defaults read "$WORK/install/Leading.app/Contents/Info.plist" CFBundleShortVersionString)"
echo "  signature:          $(codesign --verify --strict "$WORK/install/Leading.app" 2>&1 && echo valid)"
echo "  quarantine on B:    $(xattr -p com.apple.quarantine "$WORK/install/Leading.app" 2>/dev/null || echo none)"
echo "  relaunched:         $(pgrep -f "$WORK/install/Leading.app" >/dev/null && echo yes || echo no)"
echo "  app log:"
grep -v "^$" "$WORK/a.log" | sed 's/^[^]]*] /    /' | grep -iv "ApplePersistence" | head -15

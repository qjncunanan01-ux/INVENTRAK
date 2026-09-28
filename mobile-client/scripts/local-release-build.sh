#!/usr/bin/env bash
# Local release build of the customer app (bypasses the EAS free-tier quota).
#
# Produces the same kind of APK EAS builds (expo prebuild + Gradle
# assembleRelease), signed with the LOCAL release keystore at
# .keystore/inventrak-release.jks (git-ignored; created on first run).
#
# IMPORTANT SIGNING NOTE: the locally-signed APK uses a different key than
# the EAS-built ones, so Android refuses to UPDATE an EAS install with it.
# One-time fix: uninstall the old app first (demo logins are trivial, so
# nothing is lost). After that, every local build updates in place.
#
# Usage (Git Bash on Windows):
#   bash scripts/local-release-build.sh
# Output: ../INVENTRAK-production.apk (project root)
set -euo pipefail
cd "$(dirname "$0")/.." # mobile-client/

JKS_DIR=".keystore"
JKS="$JKS_DIR/inventrak-release.jks"
CREDS="$JKS_DIR/credentials.env"

# 1) Keystore: create on first run, then reuse forever (the signing identity
#    must never change, or installed apps stop updating).
if [ ! -f "$JKS" ]; then
  mkdir -p "$JKS_DIR"
  echo "== generating release keystore (one-time) =="
  keytool -genkeypair -v -keystore "$JKS" -alias inventrak -keyalg RSA \
    -keysize 2048 -validity 10000 \
    -storepass inventrak-demo-2026 -keypass inventrak-demo-2026 \
    -dname "CN=INVENTRAK, OU=Capstone, O=INVENTRAK, L=Manila, C=PH"
fi
if [ ! -f "$CREDS" ]; then
  {
    echo "INVENTRAK_RELEASE_STORE_FILE=$(pwd -W 2>/dev/null || pwd)/.keystore/inventrak-release.jks"
    echo "INVENTRAK_RELEASE_STORE_PASSWORD=inventrak-demo-2026"
    echo "INVENTRAK_RELEASE_KEY_ALIAS=inventrak"
    echo "INVENTRAK_RELEASE_KEY_PASSWORD=inventrak-demo-2026"
  } > "$CREDS"
fi
# shellcheck disable=SC1090
source "$CREDS"
export INVENTRAK_RELEASE_STORE_FILE INVENTRAK_RELEASE_STORE_PASSWORD \
  INVENTRAK_RELEASE_KEY_ALIAS INVENTRAK_RELEASE_KEY_PASSWORD

# 2) Regenerate the native project from app.json (CNG) and patch signing.
echo "== expo prebuild =="
npx expo prebuild --platform android --no-install
python scripts/patch-gradle-signing.py

# 3) Gradle release build (SDK location via android/local.properties —
#    created here if missing; adjust the path for your machine).
if [ ! -f android/local.properties ]; then
  echo "sdk.dir=C:/Users/Jico/AppData/Local/Android/Sdk" > android/local.properties
fi
echo "== gradle assembleRelease (10-40 min on first run) =="
cd android
ORG_GRADLE_JVM="-Xmx4g -XX:MaxMetaspaceSize=1g" ./gradlew.bat assembleRelease --no-daemon

# 4) Publish the APK to the project root.
cp app/build/outputs/apk/release/app-release.apk ../INVENTRAK-production.apk
echo ""
echo "== done: $(cd .. && pwd)/INVENTRAK-production.apk =="

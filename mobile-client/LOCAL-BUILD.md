# Local APK builds (bypassing the EAS free-tier quota)

EAS's free plan allows a limited number of Android builds per month. When the
quota runs out, the **customer app can still be built on this PC** — same
output as an EAS build (`expo prebuild` + Gradle `assembleRelease`), no quota.

## TL;DR

```bash
cd mobile-client
bash scripts/local-release-build.sh
# → INVENTRAK-production.apk in the project root (~36 min first run,
#   ~10 min afterwards)
```

The customer release script defaults `EXPO_PUBLIC_API_URL` to
`https://inventrak-api.onrender.com`, so an installed APK talks to the same
backend as the deployed mobile website and admin console. Set
`EXPO_PUBLIC_API_URL` before running the script only when building against a
different environment.

The local release script forces the demo policy preview off and clears Metro's
cache before packaging. EAS `preview` builds enable the demo page for adviser
testing; EAS `production` builds disable it and skip restored build caches so a
preview bundle cannot carry over.

**Signing caveat:** the local keystore differs from EAS's, so Android refuses
to install a local APK **over** an EAS-installed app: uninstall the old
customer app once (Settings → Apps → INVENTRAK → Uninstall, or long-press the
icon → Uninstall), then install the local APK. From then on, local builds
update in place. (The staff app's current APK is still the EAS v1.5.0 build;
when its next rebuild is needed after Oct 1, prefer EAS to keep one key.)

## What the script does

1. **Keystore** — creates `.keystore/inventrak-release.jks` on first run
   (git-ignored) and reuses it forever; the signing identity must never
   change or installed apps stop updating. Passwords are demo-grade and
   stored beside it in `.keystore/credentials.env`.
2. **Release bundle preflight** — forces the demo policy preview off and
   clears Metro's cache before Gradle bundles the release APK.
3. **`expo prebuild --platform android --no-install`** — regenerates the
   native `android/` project from `app.json` (continuous native generation;
   the dir is git-ignored on purpose).
4. **`scripts/patch-gradle-signing.py`** — idempotently patches
   `android/app/build.gradle` so release builds sign with the local release
   keystore via `INVENTRAK_RELEASE_*` env vars. (Groovy note baked into the
   patch: use Elvis `?:`, not `||` — `||` returns a boolean there.)
5. **`gradlew.bat assembleRelease`** — the actual build. Requirements (all
   present on this PC): JDK 21, Android SDK platforms 34–36, NDK 27.1
   (`sdkmanager "ndk;27.1.12297006"` if missing/corrupt — the empty-dir
   failure is `NDK ... did not have a source.properties file`).
6. Copies the APK to `INVENTRAK-production.apk` in the project root.

## Verification (before installing)

```bash
BT="$LOCALAPPDATA/Android/Sdk/build-tools/36.1.0"
"$BT/apksigner.bat" verify --print-certs INVENTRAK-production.apk | head -4
"$BT/aapt.exe" dump badging INVENTRAK-production.apk | grep -E '^package|application-label:'
# expect: com.inventrak.mobile, versionName matching app.json, Sylver's
```

## Staff app

The same approach works for `staff-client` if EAS is ever unavailable: copy
`scripts/local-release-build.sh` there, adjust the keystore path/passwords
(ideally to a *different* keystore), and note that a locally-signed staff APK
also needs the one-time uninstall of the EAS-installed app.

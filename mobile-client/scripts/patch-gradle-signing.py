#!/usr/bin/env python3
"""Patch android/app/build.gradle (expo prebuild output) so release builds
sign with the dedicated local release keystore (env-var driven) instead of
the debug key. Idempotent: running it twice is a no-op.

Why: `expo prebuild` regenerates the native project (CNG), wiping any manual
gradle edits — so this patch is applied by scripts/local-release-build.sh
after every prebuild. The keystore itself lives in .keystore/ (git-ignored).
"""
import io
import os

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'android', 'app', 'build.gradle')
with io.open(path, encoding='utf-8') as f:
    src = f.read()

if 'releaseLocal' in src:
    print('build.gradle already patched (releaseLocal signing present)')
    raise SystemExit(0)

old = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug"""
new = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        // Dedicated local release keystore (git-ignored, see .keystore/).
        // Kept separate from the debug key so the release signing identity is
        // stable across local builds; configured via env vars below.
        // NOTE: Groovy's Elvis (?:) is required — `||` returns a boolean here.
        releaseLocal {
            storeFile file(System.getenv("INVENTRAK_RELEASE_STORE_FILE") ?: "debug.keystore")
            storePassword System.getenv("INVENTRAK_RELEASE_STORE_PASSWORD") ?: "android"
            keyAlias System.getenv("INVENTRAK_RELEASE_KEY_ALIAS") ?: "androiddebugkey"
            keyPassword System.getenv("INVENTRAK_RELEASE_KEY_PASSWORD") ?: "android"
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Sign releases with the dedicated local release keystore when the
            // INVENTRAK_RELEASE_* env vars are set (local builds); otherwise
            // fall back to the debug key exactly as before.
            signingConfig System.getenv("INVENTRAK_RELEASE_STORE_FILE") ? signingConfigs.releaseLocal : signingConfigs.debug"""

if old not in src:
    raise SystemExit('ERROR: expected signingConfigs block not found — prebuild output changed; update this patcher.')

io.open(path, 'w', encoding='utf-8', newline='\n').write(src.replace(old, new))
print('build.gradle patched: release builds sign with the local release keystore')

# Installing the INVENTRAK APK on Android (demo guide)

This guide covers putting the **EAS-built APK** (built with
`npx eas-cli build --platform android --profile production`) onto an Android
phone for the presentation. The APK is a real app — **no Expo Go, no
internet-to-PC needed** — and it talks to the **live backend**
(`https://inventrak-api.onrender.com`, Firebase Firestore) from any network.

> For the Expo Go / dev-server way instead (scan-a-QR), see the README
> "Mobile App (Expo)" section. This guide is for the standalone APK.

---

## Latest build (Aug 11, 2026)

**Direct download link:**

```
https://expo.dev/artifacts/eas/ppG_WTLFF5dL7vzFPl_s0d4gGUsp6uRJhf-C4jDvOAo.apk
```

- **Profile:** `production` (release build, same signing key as previous
  installs → updates in place, no uninstall needed)
- **Branding:** SYLVER logo — launcher icon, adaptive icon (scaled into the
  Android mask safe zone), and a white splash screen with the centered logo
- **Login screen:** clean customer login — no API server URL field, no
  "API: https://…" text in error popups; the app always uses the baked-in
  deployed backend. **"Continue with Google"** button is now always visible
  and runs the server-side Google OAuth relay (real-name usernames, see
  DEPLOY.md "Google sign-in")
- **Scan flow:** catalog camera icon → photos are **preprocessed before
  upload** (grayscale + contrast + normalize — same as the admin scanner),
  the crop editor is disabled (fixes the black camera preview on several
  Android devices), the camera permission is declared in the manifest, and
  OCR only returns matches that name a **specific catalog product**
  (watermark/one-word scans are honest misses)
- **Catalog layout:** category + sort chip rows keep fixed heights on narrow
  phones (no more overlapping the result counter), and every list key is
  hardened so duplicate-key warnings can't appear
- **Backend:** `https://inventrak-api.onrender.com` baked in (Firestore)
- **Local copy:** `C:\Users\Jico\Desktop\INVENTRAK\INVENTRAK-production.apk`

> **QR / Expo Go alternative:** if you'd rather test the live dev bundle
> (all the same fixes, no install), scan the QR in the Preview tab — it
> points at the current tunnel (`exp://kizpk_s-patrickcuevas-8081.exp.direct`)
> and works on any network.

---

## Step 1 — Get the APK file

You get the `.apk` from the EAS build page:

1. Open `https://expo.dev/account/patrickcuevas/builds` (log in as
   `patrickcuevas` — the account username).
2. Find the latest **production** build for this project (or just use the
   direct download link in the "Latest build" section above).
3. Click **Install** (or the download icon) — this downloads
   `INVENTRAK-<buildid>.apk` (~50–80 MB).
4. The finished build also prints a direct download link in the terminal
   where you ran the build. Either way, you end up with one `.apk` file.

You now have two ways to get that file onto the phone — pick one:

### Option A — Download straight on the phone (easiest, 1 device)
1. Send yourself the download link (email / Messenger / Google Drive).
2. Open the link **on the phone** in Chrome.
3. It downloads the APK — see Step 2 to install.

### Option B — Transfer via USB cable (no link needed)
1. Plug the phone into the PC with a USB cable.
2. On the phone, allow file transfer ("File Transfer / MTP" in the USB
   notification).
3. Copy `INVENTRAK-<buildid>.apk` into the phone's **Downloads** folder.
4. On the phone, open the **Files** app → Downloads → tap the APK.

---

## Step 2 — Allow "install from unknown sources"

The APK is not from the Play Store, so Android asks for permission once:

1. Tap the APK file to open it.
2. Android shows: *"For your security, your phone is not allowed to install
   unknown apps from this source."* → tap **Settings**.
3. In the screen that opens, enable **"Allow from this source"** (the
   Files/Chrome app you used to open the APK).
4. Go back and tap the APK **again**.

---

## Step 3 — Install

1. Read the permissions screen → **Install**.
2. Wait for the progress bar (~30 seconds).
3. Tap **Done** (not "Open" yet — we'll open it in Step 4).

> **Play Protect popup?** ("Google Play Protect can't scan this app") →
> tap **More details → Install anyway**. This is normal for any
> self-distributed APK; the app is built from your own source.

---

## Step 4 — First launch (login)

1. Open **INVENTRAK** from the app drawer — you'll see the **SYLVER logo**
   on the launcher icon and the white splash screen while the app loads.
2. You land on the **Home** screen as a guest — browse the catalog freely.
3. To place an order, log in with the demo customer:
   - **Username:** `customer`
   - **Password:** `customer123`
   - (Admin sign-in stays on the web dashboard — `admin` / `admin123`.)
4. The app talks to the **live Firestore backend** automatically (URL is
   baked in). You'll see today's flash-sale picks, real stock, and your
   orders — from any Wi-Fi or mobile data.

---

## Step 5 — Demo checklist (before you present)

- [ ] APK installed, app opens to Home with category chips + flash sale
- [ ] Logged in as `customer` — cart, order inquiry, and history all work
- [ ] Backend is up: `curl https://inventrak-api.onrender.com/api/openapi.json`
      returns 200 (or just open the app — if products load, it's alive)
- [ ] Phone has a stable connection (demo day: airplane mode OFF)
- [ ] If the venue Wi-Fi is locked down, use **phone mobile data** instead —
      the app works on any network, that's the point of the deployed backend

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"App not installed"** | Your phone may be on Android 5 or lower (APK needs Android 6+), or the download was corrupted — re-download and try again. |
| **"Download blocked"** / Play Protect warning | Tap **More details → Install anyway**. |
| **App opens but no products / "network request failed"** | The live backend is down or your network blocks it. Check `https://inventrak-api.onrender.com/api/openapi.json` in the phone browser — if that fails, it's the backend, not the app. |
| **Old version installed** | Uninstall the old INVENTRAK first, then install the new APK (or it may update in place if signed the same). |
| **Login says "network request failed"** | Same as above — network/backend issue, not your password. |
| **I want a fresh demo state** | Use the web admin dashboard to approve/reject the pending orders before presenting. |

---

## If you rebuild later (new APK)

```bash
cd mobile-client
npx eas-cli login              # once per machine: qjncunanan01@tip.edu.ph
npx eas-cli build --platform android --profile production --non-interactive
# ~6–15 min on the free cloud; the terminal prints the download link
```

The `production` profile in `eas.json` already bakes
`EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com` into the build, so
a rebuild automatically points at the same live backend. The splash,
launcher icon, and adaptive icon are configured in `app.json` under
`expo-splash-screen` / `android.adaptiveIcon` — rebuild to pick up any
branding changes.

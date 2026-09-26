# Installing the INVENTRAK APK on Android (demo guide)

This guide covers putting the **EAS-built APK** (built with
`npx eas-cli build --platform android --profile production`) onto an Android
phone for the presentation. The APK is a real app — **no Expo Go, no
internet-to-PC needed** — and it talks to the **live backend**
(`https://inventrak-api.onrender.com`, Supabase PostgreSQL) from any network.

> For the Expo Go / dev-server way instead (scan-a-QR), see the README
> "Mobile App (Expo)" section. This guide is for the standalone APK.

---

## Latest builds (Sep 26, 2026 — v1.1.0, both apps)

### Customer app (INVENTRAK — `com.inventrak.mobile`)

**Direct download link:**

```
https://expo.dev/artifacts/eas/jlWwuAtPb9aHOG2coTX-SV8-1XxvhaIdkrPZKdk5Bic.apk
```

> **v1.1.0 (customer):** QR scanner + a **version marker on the login
> screen** — the app prints its own version, so an outdated install is
> obvious at a glance. **If the login screen doesn't say v1.1.0, you're
> running an old install — reinstall.** Same signing key → updates in
> place, no uninstall needed.
>
> Build ID: `72fdfa0d-ae5d-4d56-8db0-6cfb0a714687` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-mobile/builds/72fdfa0d-ae5d-4d56-8db0-6cfb0a714687

### Staff app (INVENTRAK Staff — `com.inventrak.staff`)

**Direct download link:**

```
https://expo.dev/artifacts/eas/y37dhg0032MJSHtEfdXD27yfiXRDJ6Ha1vC6pAE0MAw.apk
```

> **v1.1.0 (staff):** the staff-only tag scanner (product tags → count
> card, location tags → storage-area stock) with the same login-screen
> version marker. Sign in with the seeded staff account (`staff` /
> `staff123`) — this app refuses admin/owner/customer accounts by design.
> It is a **separate app** from the customer one (own icon, own package),
> so both can live on the same phone.
>
> Build ID: `551ee380-b4f4-4388-a89c-aa3c814fc7e5` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-staff/builds/551ee380-b4f4-4388-a89c-aa3c814fc7e5
>
> **Local copies:** `INVENTRAK-production.apk` (customer) and
> `INVENTRAK-staff.apk` (staff) in the project folder on the desktop.

> **v1.1.0 (Sep 26, earlier customer build — superseded by the one above):**
> the first version-badge build (same features). Build ID
> `4d905989-d2ef-4dd3-bd04-2a98c26263e4`, link
> `https://expo.dev/artifacts/eas/GMYLAKT3OOdSrmZBBBAa8lhPzMr2A8C3TN0cfl0lrYI.apk`.
>
> **v1.0.0 (Sep 26, QR build):** the in-app scanner is now a **QR reader** —
> the old OCR screen is gone. **This is the build that fixes the
> "no data has been found" error when scanning the printed QR tags:** the
> previously installed APK still ran the old OCR flow, which could only read
> plain-text SYLVER labels and simply couldn't decode QR codes. Also carries
> the backend QR URL-decode fix (full `INVENTRAK:PROD:<id>` payloads now
> resolve, not just bare IDs/SKUs). Same signing key as previous installs →
> updates in place, no uninstall needed.
>
> Build ID: `4006a3ba-c767-4697-919a-0b23e7da0964` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-mobile/builds/4006a3ba-c767-4697-919a-0b23e7da0964
>
> **v1.0.0 (Aug 15, final pre-demo — superseded by the QR build above):**
> rebuilt from latest `main` so the
> installed app carries **everything through today's quality pass** — the
> **pruned API facade** (the customer app no longer exposes admin-only
> endpoints), the **Google name fix** (real profile name, e.g.
> "Jerico Cunanan", not "Jerico + Cunanan"), the **security hardening pass**
> (24h session expiry, forge-proof signing keys), and all the UI/UX +
> scan-flow fixes. Same signing key as previous installs → updates in
> place, no uninstall needed.
>
> Build ID: `5145d163-d639-4480-b014-8f5095e1f48f` · Build page:
> https://expo.dev/accounts/patrickcuevas/projects/inventrak-mobile/builds/5145d163-d639-4480-b014-8f5095e1f48f
>
> **v1.0.0 (Aug 15, earlier build):** carried the Google name fix + security
> hardening pass. Build ID `b51bce7b-0a8c-45c9-b9a0-71942123f845`, link
> `https://expo.dev/artifacts/eas/-fg_iT66Cugeazb8wM9jk-q8k7ccuq-v0SRZOxzJsfk.apk` —
> superseded by the build above.
>
> **v1.0.0 (Aug 11, crash-fix build):** the previous build crashed on launch
> because `@expo/vector-icons` (tab bar / icons) needs `expo-font` as a direct
> native module — missing it, the standalone APK died at startup while Expo Go
> worked (Expo Go bundles the module). This build adds `expo-font` at the
> SDK-54 version, rebuilds the dependency tree from scratch (removed a
> corrupted duplicate), and passes `expo-doctor` 18/18. If you hit the crash
> on the previous build: **uninstall the old app, then install this one.**

- **Profile:** `production` (release build, same signing key as previous
  installs → updates in place, no uninstall needed)
- **Branding:** SYLVER logo — launcher icon, adaptive icon (scaled into the
  Android mask safe zone), and a white splash screen with the centered logo
- **Login screen:** clean customer login — no API server URL field, no
  "API: https://…" text in error popups; the app always uses the baked-in
  deployed backend. **"Continue with Google"** button is now always visible
  and runs the server-side Google OAuth relay (real-name usernames, see
  DEPLOY.md "Google sign-in")
- **Scan flow:** catalog camera icon → live QR scanning with the device
  camera, the camera permission is declared in the manifest, and only
  registered INVENTRAK product tags resolve — foreign QR codes get an
  explicit "not registered" alert and are audit-logged
- **Catalog layout:** category + sort chip rows keep fixed heights on narrow
  phones (no more overlapping the result counter), and every list key is
  hardened so duplicate-key warnings can't appear
- **Backend:** `https://inventrak-api.onrender.com` baked in (Supabase
  PostgreSQL)
- **Local copy:** `C:\Users\Jico\Desktop\INVENTRAK\INVENTRAK-production.apk`
  (customer) and `INVENTRAK-staff.apk` (staff) — both v1.1.0, downloaded
  Sep 26

> **No-install alternative:** open the customer app in any phone/desktop
> browser at the permanent hosted URL `https://inventrak-mobile.onrender.com/`
> — the same app against the same live backend, works on any network (no
> Expo Go, no dev PC, no tunnel).

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
| **Scanning a QR tag says an error / nothing found** | You're on the old OCR build — install the Sep 26 QR build above. The old app couldn't read QR codes at all. After installing, open the catalog → camera icon and point at a printed INVENTRAK tag. |
| **Login says "network request failed"** | Same as above — network/backend issue, not your password. |
| **I want a fresh demo state** | Use the web admin dashboard to approve/reject the pending orders before presenting. |

---

## If you rebuild later (new APK)

```bash
cd mobile-client
npx eas-cli login              # once per machine: qjncunanan01@tip.edu.ph
npx eas-cli build --platform android --profile production --non-interactive
# ~6–15 min on the free cloud; the terminal prints the download link

# Staff app (same account, its own project):
cd ../staff-client
npx eas-cli build --platform android --profile production --non-interactive
```

The `production` profile in `eas.json` already bakes
`EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com` into the build, so
a rebuild automatically points at the same live backend. The splash,
launcher icon, and adaptive icon are configured in `app.json` under
`expo-splash-screen` / `android.adaptiveIcon` — rebuild to pick up any
branding changes.

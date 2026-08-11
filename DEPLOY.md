# Deploying INVENTRAK to production

Goal: a **free, hosted backend running on Firebase Firestore**, with the admin
dashboard and mobile app pointed at it. The backend is a plain Node.js HTTP
server with **zero native dependencies** (`src/server_npmfree.js`) that
**auto-selects Firestore** whenever `FIREBASE_PROJECT_ID` + a service-account
credential are present — so the same code, container, tests and clients run
locally on JSON files and in production on Firestore.

Three hosts are supported. **Render** is the recommended path (free tier,
one-click from the included `render.yaml` blueprint). Railway and Cloud Run
are documented as alternates below.

```
GitHub repo ──► Render blueprint (render.yaml)
                  ├─ inventrak-api    (Node, port 4001) ──► Firebase Firestore
                  └─ inventrak-admin  (static build)  ─┐        ▲
                        ▲                              │        │
   admin dashboard ◄───┘      mobile app ── login screen API URL ─┘
```

---

## Step 0 — Firebase project + Firestore (5 minutes, once)

The one thing that requires your Google account. You're already logged into
the Firebase CLI locally (verified). The project already exists:

```bash
firebase projects:list
#   INVENTRAK  /  inventrak-6b079   ← use this one
```

In the Firebase console (console.firebase.google.com), open the **INVENTRAK**
project and check it's fully set up:

1. **Enable the Cloud Firestore API** (one click) if the project was just
   created — visit
   <https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=inventrak-6b079>
   → **Enable**. (If `firebase firestore:databases:list --project
   inventrak-6b079` lists `databases/(default)`, this is already done.)
2. **Build → Firestore Database → Create database** if no database exists yet
   (production mode is fine) — the project currently has the `(default)`
   database. A custom name (e.g. `inventrak`) also works: set
   `FIREBASE_DATABASE_ID` in the backend env and the driver targets it.
3. **Project settings → Service accounts → Generate new private key** — you
   get a `*.json` credentials file. Keep it safe; it is the key to your data.

Do **not** commit that key. You'll paste it into the host's dashboard (Step 2)
or into the env when running locally:

---

## Step 1 — Push your existing data to Firestore (optional, recommended)

If you already have products/inventory/movements/inquiries/sales/users in the
local SQLite database (`backend/data/inventrak.db`), push it once **from your
local machine** (never run the migration from the server):

```bash
cd backend
export FIREBASE_PROJECT_ID="inventrak-6b079"
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /path/to/serviceAccountKey.json)"
# optional, only if you created a named database instead of (default):
# export FIREBASE_DATABASE_ID="inventrak"

npm run migrate:firestore -- --dry-run   # preview the row counts
npm run migrate:firestore                # write it (REPLACES Firestore contents)
```

Skipping this step is fine: a brand-new Firestore project is **auto-seeded on
first server boot** with the product catalog + inventory from `backend/data/`
and the demo users (`admin/admin123`, `customer/customer123`) — so the admin
dashboard and mobile app work immediately, just without your old transactional
data.

**Passwords migrate as bcrypt hashes** (both backends hash; the SQLite side
has since launch). If any store still holds legacy plaintext (e.g. users
registered before the npm-free server hashed), re-hash it once — or just let
the first login upgrade each user automatically:

```bash
npm run hash:passwords -- --dry-run    # SQLite: how many plaintext users?
npm run hash:passwords                 # SQLite: re-hash them
npm run hash:passwords -- --firestore  # Firestore '@users' dataset
```

Run the SQLite pass while the backend is stopped (a second connection to the
same DB is fine either way, but stopping avoids lock contention); the
login-time auto-upgrade covers anything the script misses.

### Keeping the two databases in sync (instead of another one-shot migration)

Once both stores have real data, `npm run sync:firestore` converges them with
per-row changesets and conflict policies:

```bash
cd backend
export FIREBASE_PROJECT_ID="your-project-id"
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /path/to/serviceAccountKey.json)"

npm run sync:firestore -- --dry-run       # preview the changeset, touch nothing
npm run sync:firestore                    # merge both ways, apply
```

- **Conflict policy** (`--conflict=`): `last-write-wins` (default, newest
  timestamp), `keep-sqlite`, `keep-firestore`, or `skip` (report and leave
  both sides as-is).
- **One-way syncs**: `--direction=to-firestore` (SQLite wins) or
  `--direction=to-sqlite` (cloud wins). `--deletions=propagate` is only
  allowed with a one-way direction and makes the plan a mirror (absent rows
  are dropped from the target) — always review the `--dry-run` output first.
- **Password safety**: bcrypt hashes sync like any other column; conflict
  reports redact the `password` field.
- Run the SQLite-side write while the local backend is stopped (or during a
  maintenance window) — the sync opens its own `better-sqlite3` connection.

---

## Step 2 — Deploy the backend + admin to Render (free)

> **Can't access Render / no credit card?** Two no-card paths exist:
> 1. **Demo TODAY (zero accounts): Cloudflare Quick Tunnel** — run the
>    backend on your laptop and expose it publicly with one command. See
>    [Demo today: Cloudflare Quick Tunnel](#demo-today-cloudflare-quick-tunnel).
> 2. **Hosted, no credit card: Replit Deployments** — see
>    [Replit (no credit card)](#replit-no-credit-card) in Alternatives.

## Demo today: one-click launcher (double-click, no typing)

`demo-launch.bat` (repo root) starts **everything** — backend, public Cloudflare
tunnel, and admin dashboard — in one window:

1. Double-click `demo-launch.bat` (Windows). It requires only Node.js.
2. It reuses anything already running, starts the rest, downloads
   `cloudflared` automatically on first run, and prints the live summary:
   the **Public URL** (copy it for the phone), local URLs, and demo logins.
3. Close the window to stop everything.

Under the hood it runs `scripts/demo-launch.js` (zero-dependency Node
orchestrator; env-overridable: `BACKEND_PORT`, `ADMIN_PORT`, `CLOUDFLARED_BIN`).

## Demo today: Cloudflare Quick Tunnel (no account, no card)

The fastest way to a public URL with ZERO signups: Cloudflare's quick tunnels
expose a local port as an HTTPS `*.trycloudflare.com` URL — no account, no
credit card, no interstitial warning pages (unlike ngrok/localtunnel, which
break mobile apps or require tokens).

1. Start the backend locally: `cd backend && npm start` (port 4001).
2. Get the official Cloudflare binary (one-time):
   - Windows: download `cloudflared-windows-amd64.exe` from
     <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>,
     or `winget install cloudflare/cloudflared`.
   - macOS: `brew install cloudflared`. Linux: `apt install cloudflared`.
3. Expose the backend:
   ```bash
   cloudflared tunnel --url http://localhost:4001
   ```
   It prints a URL like `https://<random>.trycloudflare.com` — that's your
   live public API.
4. Mobile app — bake it in (no typing on the phone):
   ```bash
   cd mobile-client
   EXPO_PUBLIC_API_URL=https://<random>.trycloudflare.com npx expo start
   ```
   (or paste it into the login screen's API URL field — it's saved). The
   admin dashboard stays at `http://localhost:3000` on the presenting PC.

Notes: the URL changes every time the tunnel restarts (fine for a demo; use
Replit below for a stable URL). The laptop must stay on and online. Verified
live: public login/register/products all return 200 through the tunnel.

1. **Push this repo to GitHub** (`origin` is already set).
2. **render.com → New → Blueprint** → connect the GitHub repo. Render reads
   the included `render.yaml` and creates two services:
   - `inventrak-api` — the backend (Node, `node src/server_npmfree.js`)
   - `inventrak-admin` — the admin dashboard (static build)
3. **Wire in Firebase (the "everything runs on Firestore" part)** — in the
   Render dashboard open **inventrak-api → Environment → Environment
   Variables** and add the two keys:
   - `FIREBASE_PROJECT_ID` = `your-project-id` (or edit the blueprint value)
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the **entire** service-account JSON
     from Step 0, braces included.
     (Alternative: use Render **Secret Files** to mount the JSON at e.g.
     `/etc/secrets/firebase-sa.json` and set
     `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-sa.json`.)
   Then **Manual Deploy → Deploy latest commit**.
4. **Check the API is alive and on Firestore:**
   ```bash
   curl -s https://inventrak-api.onrender.com/api/openapi.json | head -c 120
   curl -s -o /dev/null -w '%{http_code}\n' https://inventrak-api.onrender.com/api/docs
   # login proves users are on Firestore:
   curl -s -X POST https://inventrak-api.onrender.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123"}'
   ```
5. **Admin dashboard**: open `https://inventrak-admin.onrender.com` and log
   in with `admin` / `admin123` (or a migrated user). The bundle already
   points at `https://inventrak-api.onrender.com` (set at build time in
   `render.yaml`; change it there if Render assigned a different URL and
   re-deploy).
6. **Mobile app — zero typing (recommended):** bake the deployed URL into the
   app at bundle time with an Expo public env var, so it talks to the deployed
   backend from ANY network (no LAN requirement, nothing to edit on the phone):
   ```bash
   cd mobile-client
   EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com npx expo start
   # (add --tunnel if the phone isn't on the same Wi-Fi as this PC)
   ```
   Log in with `customer` / `customer123` or register a new account. The URL
   is also editable on the login screen (persisted on the device) — that
   remains the manual fallback if you prefer it.
   **Gotcha:** a previously-saved URL on the phone (AsyncStorage) *overrides*
   the baked one — if the login screen still shows `http://<lan-ip>:4001`,
   replace it with the deployed URL once and it'll stick for the demo.

**Demo without Firebase (fastest path):** the backend auto-selects Firestore
only when `FIREBASE_PROJECT_ID` + a service account are set. Until you paste
them, the deployed API runs on the committed JSON catalog (auto-seeded:
8 products, 3 locations, the demo users) — fully demoable immediately. Data
written then lives on the container's ephemeral disk (free plan), so add
Firestore (Step 3) before collecting real data.

Free-tier notes: services sleep after ~15 min idle and wake on the next
request (first load after sleep can take a few seconds); Firestore is the
durable store, so nothing is lost while sleeping.

---

## Alternatives

### Replit (no credit card)

The only hosted option that needs **no credit card** (free Starter plan). The
repo includes a `replit.toml`:

1. replit.com → **Create** → **Import from GitHub** → pick this repo (public).
2. Click **Run** first — `replit.toml`'s `[run]` section installs deps and
   starts the server (look for `npm-free backend running on 3000` in the
   Console). If the preview stays blank, the Console tab shows the real error.
3. **Publish** (top-right of the workspace — Replit renamed "Deployments" to
   "Publish" in 2025) → you get a `https://<name>.replit.app` URL. Free
   deployments sleep on idle but wake on request.
4. Optional Firestore: **Environment** tab → add `FIREBASE_PROJECT_ID` +
   `FIREBASE_SERVICE_ACCOUNT_JSON` (same as Render Step 5).
5. Point the mobile app at it (`EXPO_PUBLIC_API_URL=... npx expo start` or
   the login-screen field). The admin dashboard can also be served by hosting
   the `frontend-admin` build on Replit (static) or any static host
   (Vercel/Netlify/GitHub Pages) with `REACT_APP_API_BASE_URL` set to the
   Replit URL.

### Railway (also free-tier friendly)

The repo includes a `railway.json` (builds `backend/Dockerfile`, health-checks
`/api/openapi.json`), so both a Git-integration deploy (Railway → New Project
→ Deploy from repo — root is detected from the config) and the CLI work:

```bash
cd backend
npx @railway/cli@latest init     # link to a project
railway variables set FIREBASE_PROJECT_ID=... FIREBASE_SERVICE_ACCOUNT_JSON=...
railway up
railway domain                  # gives you the public URL
```

The container runs `node src/server_npmfree.js` (set in the Dockerfile), so
the same Firebase auto-selection applies. Point the admin build and the mobile
bundle (`EXPO_PUBLIC_API_URL=https://<your-railway-url> npx expo start`) at
the Railway URL. If the admin dashboard is built elsewhere (e.g. Render),
update its `REACT_APP_API_BASE_URL` to the Railway URL and redeploy it.
(Note: `firebase-admin` is installed by `npm install`, so the Firestore driver
is available in the container. Railway only enforces the health check on
Hobby/Pro plans — it's ignored on free, which is fine.)

### Google Cloud Run

Requires the gcloud CLI + Docker:

```bash
cd backend
gcloud auth login
gcloud config set project your-project-id
docker build -t gcr.io/your-project-id/inventrak-api .
docker push gcr.io/your-project-id/inventrak-api
gcloud run deploy inventrak-api --image gcr.io/your-project-id/inventrak-api \
  --region us-central1 --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=your-project-id \
  --set-secrets FIREBASE_SERVICE_ACCOUNT_JSON=firebase-sa-json:latest
```

Then point the admin and mobile at the `*.run.app` URL Cloud Run prints.

---

## Real email + SMS notifications (verification codes, order updates)

The backend already sends real messages through **Resend** (email) and
**Semaphore** (SMS, PH gateway — or Twilio as an alternative). Providers are
env-configured and fire-and-forget, so nothing breaks when they're missing —
but without keys, messages are only **logged**, not delivered. To enable real
delivery on the deployed server:

### 1. Email — generic SMTP (recommended, delivers to ANY recipient)

The backend has a **zero-dependency SMTP client** (`SMTP_HOST` + `SMTP_PORT` +
`SMTP_USER` + `SMTP_PASS` + `EMAIL_FROM`), so any provider that offers SMTP
works and delivers to **any** recipient — no domain required:

- **Gmail / Google Workspace** (fastest): enable 2-Step Verification on the
  account, create an **App Password** (myaccount.google.com → Security →
  2-Step Verification → App passwords), then:
  ```
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_USER=you@gmail.com
  SMTP_PASS=<the 16-char app password>
  EMAIL_FROM=INVENTRAK <you@gmail.com>
  ```
- **Brevo** (free tier, 300 emails/day): add + verify a sender email, then use
  their SMTP (`smtp-relay.brevo.com:587`, your Brevo login + SMTP key).
- Port convention: `587` → STARTTLS, `465` → implicit TLS (`SMTP_SECURE`
  overrides). When `SMTP_HOST` is set it takes priority over Resend.

  > **Two operational notes:** (1) if `SMTP_HOST` is unreachable, each
  > notification waits up to ~15s before logging the failure — keep the host
  > correct. (2) Always use port 465 or a STARTTLS-capable 587 server with
  > real credentials: on a plain 587 connection with no STARTTLS, `AUTH PLAIN`
  > would send the password in the clear (fine for sandbox SMTP only).

### 1b. Email (alternative) — Resend (free tier, ~100 emails/day)

1. Go to <https://resend.com> → sign up (free) → **API Keys** → create a key
   (starts with `re_`).
2. **Sender**: for testing, `EMAIL_FROM=INVENTRAK <onboarding@resend.dev>`
   works out of the box (no domain setup). To send as your own address, add a
   domain in Resend (**Domains** → add → verify DNS) and set
   `EMAIL_FROM=INVENTRAK <hello@yourdomain.com>`.

   > **Important caveat:** the free `onboarding@resend.dev` sender can only
   > deliver to **the Resend account owner's own inbox** until you verify a
   > domain. So for a live demo, register the test account with the same email
   > you used for Resend — otherwise the verification code email is rejected
   > and signup stalls. Add a verified domain (or switch to SMTP above) before
   > letting real customers register.

### 2. SMS — Semaphore (Philippines) or Twilio

**Semaphore** (recommended for PH numbers, prepaid credits):
1. <https://semaphore.co> → sign up → **Account** → **API Key**.
2. **Settings → Sender Names** → register a sender name (e.g. `INVENTRAK`,
   approval takes minutes) → set `SEMAPHORE_SENDER_NAME=INVENTRAK`.
3. Top up a small amount — each SMS is roughly ₱0.35–0.70.

**Twilio** (alternative, international): create an account, buy a number,
set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.

### 3. Wire the keys into the deployed server

In the Render dashboard: **inventrak-api → Environment → Environment
Variables** → add the keys (or fill the commented placeholders in
`render.yaml` and redeploy):

```
# Email (pick one):
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM
# or
RESEND_API_KEY / EMAIL_FROM

# SMS:
SEMAPHORE_API_KEY
SEMAPHORE_SENDER_NAME
```

### 4. Prove it actually sends (before the demo)

```bash
cd backend
RESEND_API_KEY=re_xxx SEMAPHORE_API_KEY=xxx \
TEST_EMAIL=you@example.com TEST_PHONE=09171234567 \
EMAIL_FROM='INVENTRAK <onboarding@resend.dev>' \
SEMAPHORE_SENDER_NAME=INVENTRAK \
npm run notify:test
```

It sends a real test email + test SMS and prints `PASS`/`FAIL` per channel
(exit code 0 = all configured channels delivered). Then do the live check:
register a new account in the mobile app → you'll receive the 6-digit
verification code by email (and SMS if you added a phone).

## Google sign-in ("Continue with Google")

The mobile login screen shows a **Continue with Google** button. Sign-in runs
through the **backend OAuth relay** — the app itself carries no OAuth
credentials:

```
app → GET /api/auth/google/start?returnUrl=<app deep link>
     → 302 to accounts.google.com (backend's own https callback as redirect_uri)
     → Google consent → GET /api/auth/google/callback?code=…&state=…
     → backend exchanges the code with the web client's SECRET (server-side
       only), verifies the id_token, creates/links the account
     → 302 back to the app deep link (?token=…&username=…&email=…)
```

The relay exists because Expo Go deep links (`exp://…`) can never be
registered as Google OAuth redirect URIs (Google only accepts `https` for
web clients) and the old auth.expo.io proxy is deprecated — so the web
client's secret stays on the server, which is exactly what Google's
"OAuth 2.0 policy for keeping apps secure" requires. The backend still also
accepts an id_token directly via `POST /api/auth/google` (programmatic
clients) with the same find-or-create logic.

On first sign-in the account is auto-created with the **verified profile
name** as the username (e.g. "Jerico Cunanan", not "jericocunanan09123");
signing in with Google on an existing password account links it (same
identity, no duplicate). Usernames are sanitized (letters/digits/space
kept) and deduped, and every new Google account is `email_verified = true`.

### 1. Create the web OAuth client (Google Cloud Console, ~10 min, once)

1. Go to https://console.cloud.google.com → pick the project you want the
   client to live in (note its project id — the client and the consent
   screen must be in the SAME project).
2. **APIs & Services → OAuth consent screen** (the **Branding** tab) →
   External → app name `INVENTRAK` + your support email → save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type **Web** → name it (e.g. `INVENTRAK Web`) → **Create** →
   copy the Client ID (`….apps.googleusercontent.com`).
   - The web client also has a **Client secret** — copy it too (used server-side).
4. Open the created client and add the **Authorized redirect URI**
   (replace the URL with your deployed API):
   ```
   https://inventrak-api.onrender.com/api/auth/google/callback
   ```
5. **OAuth consent screen → Audience** tab → **Publish app → Confirm**
   (only basic email/profile scopes are used, so no Google verification is
   required). While in **Testing** mode only accounts you list under **Test
   users** (same page) can sign in — publishing lifts that limit.

### 2. Wire it into the backend (Render)

**Service Environment Variables** (`inventrak-api` → Environment):
```
GOOGLE_CLIENT_IDS=<web-client-id>        # the web client from step 3
GOOGLE_CLIENT_SECRET=<web-client-secret> # the secret from step 3
# optional override (default: derived from the request, https on Render):
# GOOGLE_OAUTH_CALLBACK_URL=https://inventrak-api.onrender.com/api/auth/google/callback
```
`GOOGLE_CLIENT_SECRET` is the secret that makes the relay live: without it
`/api/auth/google/start` answers `501`. No build-time env vars are needed in
the mobile app — the button always works and just opens the relay URL.

### 3. Verify
- `GET /api/auth/google/start?returnUrl=exp://host/--/auth` → `302` to
  `accounts.google.com` with `redirect_uri` = your callback (else `501` if
  `GOOGLE_CLIENT_SECRET` is missing, `400` for a non-app return URL).
- App: tap **Continue with Google** → Google account chooser → back in the
  app logged in (account auto-created on first use). Works in Expo Go
  (`exp://` return) and the installed APK (`inventrak://` return).
- The new account appears in `users` (Firestore console / admin users) with
  `google_sub` set, `email_verified = true`, and the profile name as username.
- `POST /api/auth/google` returns `401` for a forged token and `501` when
  `GOOGLE_CLIENT_IDS` is unset (contract-tested on both backends); the relay
  endpoints are covered by unit + end-to-end tests (`google-relay.test.js`).

## Verification checklist

- [ ] `GET /api/openapi.json` returns the spec (200)
- [ ] `GET /api/docs` renders Swagger UI
- [ ] `POST /api/auth/login` with `admin/admin123` returns a token
- [ ] Admin dashboard loads at its URL and the Dashboard counters match
      Firestore (products, inventory, alerts)
- [ ] Mobile app logs in via the deployed API URL; an order inquiry placed on
      the phone appears in the admin Order Inquiries page
- [ ] (If configured) the login screen shows **Continue with Google** and a
      Google sign-in creates/links the account (relay: `GOOGLE_CLIENT_IDS` +
      `GOOGLE_CLIENT_SECRET` set, callback URI registered, consent screen
      published)
- [ ] Firestore console shows the `products`, `inventory`, `users` collections

## Safety / rollback

- The migration **replaces** Firestore contents with the SQLite snapshot —
  run it once, or only when you deliberately want SQLite to win. For
  ongoing convergence use `npm run sync:firestore` instead (changeset-based,
  conflict-aware; `--dry-run` previews everything).
- If anything goes wrong with Firestore, pin `DB_DRIVER=json` on the service
  to fall back to the local files (ephemeral on the free plan).
- Rotate the service-account key / regenerate it any time if it leaks.
- For a real production rollout: set `NPMFREE_TOKEN_SECRET` (HMAC signing
  key), enable a paid plan (no cold starts), and add a database-level backup.

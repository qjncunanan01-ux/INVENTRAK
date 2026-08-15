# INVENTRAK — Demo Script & Pre-Demo Checklist

The one-page script for tomorrow's presentation. Everything below is **live
right now** (verified Aug 15, 2026): the backend runs on Render with Firebase
Firestore, the admin dashboard and mobile web site are deployed, and the APK
talks to the live backend from any network.

> Related docs: [APK-INSTALL.md](APK-INSTALL.md) (installing on Android),
> [DEPLOY.md](DEPLOY.md) (how it's hosted). This file is the *script*.

---

## 1. Pre-demo checklist (do 30 minutes before)

| # | Item | How to confirm |
|---|------|----------------|
| 1 | Backend up | Open `https://inventrak-api.onrender.com/api/openapi.json` — JSON renders |
| 2 | Admin up | Open `https://inventrak-admin.onrender.com` — login page loads. **Hard-refresh (Ctrl+Shift+R)** once to drop any cached bundle |
| 3 | Mobile web up | Open `https://inventrak-mobile.onrender.com` — app loads |
| 4 | APK installed on phone | The **final pre-demo build (Aug 15, evening)** — see the latest link in APK-INSTALL.md. Same signing key → updates in place |
| 5 | Internet on the demo machine + phone | Backend is hosted — no Wi-Fi pairing needed |
| 6 | Google sign-in works (optional) | Gmail button appears on the mobile login screen; test users approved in the Google Cloud console |

**Demo credentials (all verified live):**
- Admin dashboard: `admin` / `admin123`
- Demo customer (mobile): `customer` / `customer123`
- Google sign-in: any approved test Gmail — creates/links an account by email

---

## 2. The demo flow (about 8 minutes)

### Part A — Mobile app (phone, 3–4 min)

1. **Open the app** → lands on the Home screen (product catalog — no login
   required to browse). Show the category chips and the Flash Sale carousel.
2. **Tap a product** → product detail with photo and price.
3. **Tap Add to Cart** as a guest → the app prompts you to **create an
   account or log in first** (Shopee-style gating).
4. **Create an account** (or log in with the demo customer):
   - Sign up asks for name, email, **phone (required)**, strong password,
     and the **Data Privacy consent** checkbox.
   - A **verification code** is emailed/SMS'd — enter it (or demo "skip";
     the code also shows in the backend console if you want to show it).
   - **Google button**: sign in with a test Gmail → account auto-creates
     with your real profile name (e.g. "Jerico Cunanan").
5. **Add a product to the cart** → cart badge updates. Open the cart → shows
   qty, price, total.
6. **Checkout** → Order Inquiry form → choose **GCash** (shows the payment
   step / QR demo) or **Cash on Delivery** → place the order.
7. **Order history** (Account → Orders) → the new order appears with its
   status timeline (Placed → Approved → Delivered) as the admin updates it.
8. **Notifications** tab → shows per-account order status updates.

### Part B — Admin dashboard (desktop browser, 3–4 min)

1. **Log in** (`admin` / `admin123`).
2. **Dashboard** → KPI cards: 192 products, 57,455 stock units, sales value,
   **pending inquiries** (this number jumps when you place the phone order —
   refresh to show the count change).
3. **Products** → the 192-product catalog with photos, search bar, bulk
   price upload (CSV / paste).
4. **Inventory** → per-location stock (Showroom, Stockroom 1, Stockroom 2).
5. **Order Inquiries** → find the order you just placed on the phone.
   **Approve it** (or Fulfill) → the mobile order history timeline updates
   to "Approved" (show both screens together).
6. **Scan & Stock** (the capstone highlight) → upload a product label photo →
   OCR matches the catalog and shows **live stock at every location** — the
   answer to the company's 5–6-year manual inventory problem.
7. **Optimization** → ABC classification (which products carry the value).
8. **Reports** → the printable management report (Print / Save PDF).

### Part C — Security/quality pitch (optional, 1–2 min)

If a judge asks "how do you keep customer data separated / safe?":
- **Per-account isolation** — order history, cart, and notifications are
  scoped per account; tested by regression suites (301 backend + 20 admin
  tests on every push).
- **Auth hardening** — bcrypt-hashed passwords, 24h expiring signed tokens,
  login brute-force lockout with exponential backoff, bot honeypot, admin-only
  endpoints (sales/alerts/users) locked server-side.
- **API contract** — an OpenAPI 3.0 spec drives generated clients for both
  frontends; contract tests assert both backends return identical shapes.

---

## 3. If something fails mid-demo

| Symptom | Fix |
|---------|-----|
| Admin shows "0" on a card | Hard-refresh (Ctrl+Shift+R). The dashboard restored-session fix is live |
| Login fails "Invalid credentials" | Re-type `admin`/`admin123`; tokens from before the security pass are expired (by design) |
| Phone order doesn't appear in admin | Check the phone shows a success screen (order #), then refresh the admin Order Inquiries page |
| Google button errors | It needs the backend env (`GOOGLE_CLIENT_IDS` + `GOOGLE_CLIENT_SECRET`) and the test user approved in Google Cloud. Password login always works as fallback |
| Camera black on Scan & Stock | Use **Upload image** instead — OCR runs on the photo the same way |

---

## 4. Live URLs (put these on a slide)

- **Backend API:** https://inventrak-api.onrender.com
- **Admin dashboard:** https://inventrak-admin.onrender.com
- **Mobile web:** https://inventrak-mobile.onrender.com
- **API docs (Swagger):** https://inventrak-api.onrender.com/api/docs
- **GitHub repo:** https://github.com/qjncunanan01-ux/INVENTRAK

_Last verified: Aug 15, 2026 — backend 301/301 tests, admin 20/20, all live
endpoints green, APK link downloadable (90.6 MB)._

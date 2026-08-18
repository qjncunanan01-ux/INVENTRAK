# INVENTRAK — Demo Script & Pre-Demo Checklist

The one-page script for tomorrow's presentation. Everything below is **live
right now** (verified Aug 18, 2026): the backend runs on Render with Firebase
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
- Staff dashboard (role-based access): `staff` / `staff123` — sees only Dashboard, Inventory, Scan & Stock, Stock Movement (view), Stock Adjustments, Stock Transfers, Optimization, Reports. Products, Approvals, Order Inquiries, Locations, and Security are admin-only.
- Demo customer (mobile): `customer` / `customer123`
- Google sign-in: any approved test Gmail — creates/links an account by email

**⚠️ Demo-day notes — read before the demo (both verified live Aug 15):**

1. **The verification email only reaches ONE inbox.** Resend's free
   `onboarding@resend.dev` sender delivers only to the email that owns the
   Resend account — `qjncunanan01@tip.edu.ph`. If the live signup uses any
   other address, the code never arrives (`notify.email: false` was confirmed
   against the deployed server). **For the demo, sign up with
   `qjncunanan01@tip.edu.ph`** so the code lands in front of the judges.
   (Once a real domain is verified in Resend, any inbox works.)
2. **SMS is not demo-ready yet.** The Semaphore SMS account is status
   **"Pending" with 0 credits**, so no SMS sends (no code SMS, no order-update
   SMS). Even once approved and funded, it only sends to a **real PH mobile
   number** — fake numbers like `09171234567` are rejected. The **email path is
   the one to demo**; treat SMS as "works once the account is approved + a real
   number is used".
3. **The demo customer has NO orders yet.** The seeded `customer` account has
   an empty order history (the 6 seeded inquiries belong to Juan/Maria/Paolo/
   Jerico/Bettina, not `customer`). So in Part A step 7, the history list is
   **empty until you place the order in step 6** — that's expected and is
   actually a clean way to show "new order lands here with its timeline". If
   you'd rather show history with existing orders, log in as one of the seeded
   owners instead (or pre-place an order the night before).

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
   - A **verification code** is emailed — enter it to finish signup. Per the
     demo-day notes above, use the owner email (`qjncunanan01@tip.edu.ph`)
     so the code actually arrives. (On the deployed server the code is in
     the email only — it is NOT echoed in the API response.)
   - **Google button**: sign in with a test Gmail → account auto-creates
     with your real profile name (e.g. "Jerico Cunanan").
5. **Add a product to the cart** → cart badge updates. Open the cart → shows
   qty, price, total.
6. **Checkout** → Order Inquiry form → choose **GCash** (shows the payment
   step / QR demo) or **Cash on Delivery** → place the order.
7. **Order history** (Account → Orders) → the new order appears with its
   status timeline (Placed → Approved → Delivered) as the admin updates it.
   *(The list starts empty for the `customer` demo account — see demo-day note
   3 — so this step shows exactly the order you just placed.)*
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
  scoped per account; tested by regression suites (330 backend + 27 admin
  tests on every push).
- **Auth hardening** — bcrypt-hashed passwords, 24h expiring signed tokens,
  login brute-force lockout with exponential backoff, bot honeypot, admin-only
  endpoints (sales/alerts/users) locked server-side.
- **Role-based access control (staff vs owner)** — see Part D below: staff
  can *request* stock changes but only the owner can *approve* them.
- **API contract** — an OpenAPI 3.0 spec drives generated clients for both
  frontends; contract tests assert both backends return identical shapes.

### Part D — Staff vs Owner approval workflow (the request-and-approve highlight, 2–3 min)

This is the "approval of important transactions" answer for the evaluators:
staff propose, the owner decides. Demo it as a complete loop on the live
admin dashboard.

1. **Log out** of the admin account. **Log in as `staff` / `staff123`** →
   note the orange **STAFF** badge next to the title, and the **reduced
   sidebar**: Dashboard, Inventory Levels, Stock Movement, Stock
   Adjustments, Stock Transfers, Scan & Stock, Optimization, Reports.
   Call out what staff CANNOT see — **no Products, Approvals, Order
   Inquiries, Branch Locations, or Security** (even typing the URL
   redirects back to the Dashboard).
2. **Stock Movement page** → staff see the movement **history only** (the
   "New stock movement" form is hidden — recording movements is owner-only).
3. **Stock Adjustments** → click **New adjustment** and create one, e.g.:
   product = any item, location = Showroom, **new quantity** = current + 10
   (or any correction), reason = "Staff count correction during inventory".
   Submit → it's saved as **pending**. Say: *"Staff can propose, but they
   can't apply it — it now waits for the owner."*
4. Try to open **Approvals** while logged in as staff → it's not in the
   sidebar (and the URL redirects). The staff account simply has no way to
   approve.
5. **Log out**, **log in as `admin` / `admin123`** → green **ADMIN** badge,
   full sidebar, **Approvals** is back.
6. **Approvals** → the adjustment you just created is waiting (pending
   adjustments table, alongside any pending transfers). Click **Approve** →
   the system says the change was applied to stock.
7. **Inventory Levels** → find the product → the quantity now reflects the
   new count. **Order Inquiries → Approvals** shows the request as decided.
   That's the full loop: **request → approve → stock updated**, with a
   clear audit trail (who proposed, who decided, when).

*Tip: this writes a real adjustment to the live Firestore. Approving it in
step 6 completes the flow, so the demo ends with consistent data. If you'd
rather not change stock, reject the request instead — stock stays untouched
and the audit trail still shows the decision.*

---

## 3. If something fails mid-demo

| Symptom | Fix |
|---------|-----|
| Admin shows "0" on a card | Hard-refresh (Ctrl+Shift+R). The dashboard restored-session fix is live |
| Login fails "Invalid credentials" | Re-type `admin`/`admin123`; tokens from before the security pass are expired (by design) |
| Phone order doesn't appear in admin | Check the phone shows a success screen (order #), then refresh the admin Order Inquiries page |
| Google button errors | It needs the backend env (`GOOGLE_CLIENT_IDS` + `GOOGLE_CLIENT_SECRET`) and the test user approved in Google Cloud. Password login always works as fallback |
| Camera black on Scan & Stock | Use **Upload image** instead — OCR runs on the photo the same way |
| Verification code never arrives | You likely signed up with an address other than `qjncunanan01@tip.edu.ph` — Resend's free sender only delivers to the owner inbox. Re-register with that email, or log in with the demo customer |
| No SMS received | Semaphore is still **Pending / 0 credits** — not demo-ready. Demo the email leg instead; SMS works once approved + funded and a real number is used |

---

## 4. Live URLs (put these on a slide)

- **Backend API:** https://inventrak-api.onrender.com
- **Admin dashboard:** https://inventrak-admin.onrender.com
- **Mobile web:** https://inventrak-mobile.onrender.com
- **API docs (Swagger):** https://inventrak-api.onrender.com/api/docs
- **GitHub repo:** https://github.com/qjncunanan01-ux/INVENTRAK

_Last verified: Aug 18, 2026 — backend 330/330 tests, admin 27/27, all live
endpoints green (incl. staff-role split + role badge), APK link downloadable._

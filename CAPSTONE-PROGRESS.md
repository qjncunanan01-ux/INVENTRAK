# INVENTRAK — Capstone Progress Tracker

**Overall status: ~60% of the capstone complete** (30 of 50 tracked milestones done, as of September 9, 2026).

> How to read this: the checklist below is the full project plan split into 50 concrete
> milestones. Checked items are **shipped and verified** in the live system (not just
> coded — tested and deployed). This file is the single source of truth for progress
> reports to the adviser/panel.

| Workstream | Done | Total | % |
|---|---|---|---|
| 1. Core Platform & Deployment | 6 / 6 | 100% |
| 2. Authentication & Security | 7 / 8 | 88% |
| 3. Role-Based Access & Approvals | 4 / 4 | 100% |
| 4. Inventory & Multi-Location | 4 / 6 | 67% |
| 5. OCR & QR Scanning | 5 / 6 | 83% |
| 6. Decision Support (EOQ/ROP/ABC) | 3 / 4 | 75% |
| 7. Customer Mobile App | 5 / 8 | 63% |
| 8. Notifications | 3 / 4 | 75% |
| 9. Payments | 1 / 4 | 25% |
| **10. Paper, Testing & Presentation** | **0 / 8** | **0%** |
| **TOTAL** | **30 / 50** | **60%** |

---

## 1. Core Platform & Deployment — 6/6 ✅

- [x] Backend API with all business modules (`/api/*`, Swagger docs at `/api/docs`)
- [x] Three swappable storage drivers — JSON (dev), Firestore, Supabase (live) — one interface
- [x] Deployed live on Render: `inventrak-api.onrender.com` (auto-deploys on push)
- [x] Admin dashboard deployed live: `inventrak-admin.onrender.com` (Vite build, code-split)
- [x] Public API docs site on GitHub Pages (Swagger UI)
- [x] CI pipeline: tests + catalog-drift guard + OpenAPI client regeneration on every PR

## 2. Authentication & Security — 7/8

- [x] Username/password login with bcrypt hashing + password policy
- [x] Generic "invalid username or password" errors (no user enumeration)
- [x] Failed-login lockout (anti brute-force)
- [x] Email/SMS verification codes (HMAC-keyed, persistent across redeploys)
- [x] Google sign-in (OAuth relay → Firestore/Supabase `google_sub` link, real-name usernames)
- [x] Admin MFA (TOTP) + one-time recovery codes, hashed at rest
- [x] Full OWASP hardening pass + audit log + `SECURITY.md` mapping every control to code
- [ ] External security review / penetration test write-up for the paper

## 3. Role-Based Access & Approvals — 4/4 ✅

- [x] Three roles wired end-to-end: Customer / Staff / Owner(Admin)
- [x] Maker–approver queue: staff stock adjustments stay *pending* until the owner approves
- [x] Per-account data isolation (orders, cart, notifications) — regression-tested on both backends
- [x] Role badges + demo-credential quick-fill on web and mobile for presentations

## 4. Inventory & Multi-Location — 4/6

- [x] Product catalog (204 items) synced to the real Sylver price list
- [x] Per-location stock: Showroom, Stockroom 1, Stockroom 2 (tags + consolidated totals)
- [x] FIFO stock movements ledger + full stock adjustment/transfer workflows
- [x] Low-stock alerts (auto-created, resolvable, dashboard badges)
- [ ] Barcode-based stock-in/stock-out receiving (QR scan exists; barcode import pending)
- [ ] Physical inventory count reconciliation report (variance report)

## 5. OCR & QR Scanning — 5/6

- [x] Customer OCR: scan a product label → matched product page (member-only)
- [x] Staff mobile OCR: scan → verify-and-confirm screen → pending stock count
- [x] Admin Scan & Stock: OCR with per-location quantity prefill + approval queue
- [x] SYLVER-only guard + "no product detected" messaging + text filtering
- [x] QR location tags (printable) + in-app QR/barcode scanner routing
- [ ] OCR accuracy evaluation write-up (sample-size testing for the paper)

## 6. Decision Support — 3/4

- [x] EOQ, Reorder Point, and Safety Stock computed per product (backend)
- [x] ABC classification (drives Flash Sale picks and Recommendations)
- [x] Automated low-stock alerts against computed ROP
- [ ] Forecasting comparison (e.g., moving average vs. EOQ results) for the paper's analysis chapter

## 7. Customer Mobile App — 5/8

- [x] Full catalog: search, categories, product detail, cart, order inquiry (COD)
- [x] Stock badges (In stock / Low / Out) on cards and recommendations
- [x] Google sign-in + session persistence (survives refresh/restart)
- [x] SDK 57 upgrade — works on current iOS/Android Expo Go, cold-start retry to Render
- [x] Production APK pipeline (EAS), install guide (`APK-INSTALL.md`)
- [ ] GCash checkout inside the app (backend contract done, keys pending)
- [ ] Push notifications (in-app feed done; true push not started)
- [ ] Play Store / App Store listing (APK sideload only for now)

## 8. Notifications — 3/4

- [x] In-app notifications feed (order status timeline, per-account)
- [x] Email provider wired (Resend/SMTP) with log-mode fallback for demos
- [x] SMS provider wired (Semaphore/Twilio) with log-mode fallback
- [ ] Verified sender domain (free-tier emails currently land in spam/owner-only)

## 9. Payments — 1/4

- [x] COD order flow end-to-end (the demo path) + PayMongo GCash backend contract
- [ ] PayMongo live/test keys wired into Render
- [ ] Webhook endpoint for automatic payment confirmation
- [ ] Payment receipt/records screen for admins

## 10. Paper, Testing & Presentation — 0/8 ⬅️ *the remaining 40% lives here*

- [ ] Capstone manuscript: Chapters 1–3 (final-form)
- [ ] Capstone manuscript: Chapter 4 (methodology/system architecture) with screenshots
- [ ] Capstone manuscript: Chapter 5 (testing results — cite the 330 backend + 28 admin + 30 smoke checks)
- [ ] Company UAT sign-off document (SYLVER owner/staff testing session)
- [ ] User manual (admin + staff + customer)
- [ ] Defense slide deck + printed demo script (DEMO-SCRIPT.md is the source)
- [ ] Full dress-rehearsal recording (backup if live demo fails)
- [ ] Final panel presentation

---

## Evidence bank (for the paper — everything above is verifiable)

- **Test suites:** backend `npm test` → 330/330 · admin → 28/28 · 30-check smoke suite → 30/30 (Sep 9, 2026)
- **Live deployments:** API + admin on Render, docs on GitHub Pages — all serving at time of writing
- **Live end-to-end proof:** customer order → per-account scoping → admin approval → status timeline (Sep 9, 2026)
- **Security artifacts:** `SECURITY.md` (OWASP control → code map), audit log, MFA + recovery codes
- **Docs for reproducibility:** `README.md`, `MODULES.md`, `DEPLOY.md`, `DEMO-SCRIPT.md`, `APK-INSTALL.md`

> Tip for the progress report: workstreams 1–3 are effectively "done and defended-ready";
> the honest remaining risk is workstream 10 (the paper itself) and the PayMongo keys.

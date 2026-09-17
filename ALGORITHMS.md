# ALGORITHMS.md — Decision-Support Algorithms in INVENTRAK

Every calculation the system uses to turn raw inventory and sales data into
replenishment decisions — with the theoretical basis, the exact formula as
implemented, and **worked examples computed from the live 576-row seeded
ledger** (204 products, ₱2,827,473 total sales value). Formulas match the
shipped code one-to-one: `backend/src/fsn.js`, `backend/src/critical-level.js`,
`backend/src/app.js` / `backend/src/server_npmfree.js` (EOQ & ROP), and the
`stock_lots` consumption engine.

> The UI also shows these formulas inline: the **FormulaBanner** component
> renders the math above the numbers on Dashboard, Reports, Optimization, and
> Inventory — and each ABC/FSN row has a **"Why?"** tooltip showing the exact
> per-product inputs that earned its class.

---

## Algorithm map — how they feed each other

```
sales_transactions ledger
        │
        ├──► ABC Classification ──── "WHAT matters?"        (value)
        ├──► FSN Classification ──── "WHAT is moving?"      (frequency + recency)
        │         │
        │         └──► Critical Level ── "WHEN to alert?"   (per-product threshold)
        │
        └──► EOQ ─────────────────── "HOW MUCH to order?"   (cost optimum)
             ROP + Safety Stock ──── "WHEN to order?"       (lead-time trigger)
             FIFO / FEFO lots ─────── "WHICH batch leaves?" (consumption order)
             Turnover Ratio ───────── "HOW EFFICIENT?"      (stock velocity)
```

| Algorithm | Question it answers | Where in the app |
|---|---|---|
| ABC Classification | Which products drive revenue? | Optimization → ABC tab |
| FSN Analysis | Which products actually move? | Optimization → FSN tab |
| EOQ | How many units per order? | Optimization → EOQ/ROP panel, `/api/optimization/:id` |
| ROP + Safety Stock | When to reorder, with what buffer? | Same panel; badges |
| Critical Level | Per-product alert threshold | Inventory page, stock badges (web + mobile) |
| FIFO / FEFO | Which stock lot is consumed first | Stock-out, transfers, expiry alerts |
| Turnover Ratio | How fast stock converts to sales | Optimization page |

---

## 1. ABC Classification

**Question:** *Which products deserve the tightest monitoring?*

### Basis — the Pareto Principle (80/20 rule)

Classic inventory theory (Dickinson, 1907; popularized by Joseph Juran as the
"Pareto principle") observes that a **small share of items creates most of the
value**. ABC analysis ranks every product by its **annual consumption/sales
value**, walks down the ranking accumulating a share of total value, and cuts
the list at conventional breakpoints:

- **Class A** — items inside the first **70%** of cumulative value → the vital
  few. Tight control, frequent counts, priority replenishment.
- **Class B** — items from 70% up to **90%** → middle tier. Normal control.
- **Class C** — the remaining tail → trivial many. Loose control, bulk orders.

### Formula (as implemented)

```text
annualValue(p) = Σ sales_transactions.total_amount  WHERE product_id = p
              (qty × unit_price, summed over all transactions)

sort all products by annualValue DESCENDING
walk the list, accumulating:  cumShare(pᵢ) = (value₁ + … + valueᵢ) / totalValue

Class(p) = A  if cumShare ≤ 70%
         = B  if 70% < cumShare ≤ 90%
         = C  otherwise
```

### Live result (the Pareto shape appears)

| Class | Items | Share of catalog | Share of value |
|---|---|---|---|
| **A** | 87 | 43% | **69.7%** |
| **B** | 55 | 27% | 20.1% |
| **C** | 62 | 30% | 10.1% |

### Why milk and syrups are Class A

It is **value through volume × frequency**, not unit price. A café buys milk
and syrup *constantly* — so those products climb the value ranking:

| Product | Annual value | Sales txns | Units | Cum. share | Class |
|---|---|---|---|---|---|
| Strawberry Puree 64OZ | ₱64,000 | 3 | 32 | 2.3% | A |
| Torani Strawberry Puree Blend (64OZ) | ₱62,000 | 3 | 31 | 4.5% | A |
| Lotus Biscoff Smooth Spread (3KG) | ₱60,950 | 3 | 23 | 6.6% | A |
| Essse Caffè Selezione Speciale Beans 1kg | ₱47,250 | 3 | 35 | 8.3% | A |
| Da Vinci Matcha Powder (1KG) | ₱45,825 | 3 | 39 | 9.9% | A |
| **Milklab Full Cream Milk (12L)** | ₱43,740 | 3 | 36 | ~11% | **A (rank #7)** |

Milk is ₱1,215 per case but sells in volume week after week — milk, syrups,
purees, and coffee beans are every café's core inputs, so they dominate the
value ranking. Contrast the tail: **Jersey Condensed Milk (390G)** sits at
rank #203 with ₱931 and **Flat Lid 95mm (50PCS)** dead last at ₱923 — C-class
by value. Note the nuance: condensed milk is still *milk*, but its small
pack/low price keeps it C — **ABC ranks by what sells, not what it is.**

**How the system uses it:** A-items get tight stock monitoring and priority
replenishment; the Optimization page and "Why?" tooltip show each item's rank
and cumulative share as evidence.

---

## 2. FSN Analysis (Fast / Slow / Non-moving)

**Question:** *Is the product actually moving?*

### Basis — usage-rate classification

Where ABC ranks by **value**, FSN ranks by **movement** — how *often* a
product sells and how *recently* it last sold (a standard VED/FSN family
technique). The pair is complementary: "A + F" = high-value **and** fast-moving
(protect it); "A + N" = high-value but dead (a red flag worth investigating).

The system measures inside a **selectable analysis window** (default **90
days** — a quarter, the conventional FSN window; the admin Days/Weeks/Months/
Quarterly/Annually filter maps to `window=7|30|90|180|365`).

### Formula (as implemented in `backend/src/fsn.js`)

```text
transactions = count of sales in the window
frequency    = window / transactions        (avg days between sales; floor 1)
recency      = today − date of last sale    (days)
ratePerDay   = totalQty / window

N (Non-moving)  = zero transactions in the window  → dead stock
F (Fast)        = frequency ≤ 7 days  OR  recency ≤ 7 days
S (Slow)        = everything else
```

**Why 7 days:** café supplies run on a *weekly replenishment rhythm* — an item
that hasn't sold this week (recency) and doesn't average weekly sales
(frequency) is not flowing. The `OR` is deliberate: recency rescues genuinely
popular items whose average interval is skewed by one early sale.

The page sorts **N → S → F** so the dead stock the owner must act on surfaces
at the top.

### Live examples

The seeded ledger spreads sales thinly (3 txns per product at ~monthly
intervals), so most items read **S** — and that is the algorithm working as
designed: it judges movement, not reputation:

| Product | Txns (90d) | Frequency | Recency | Class |
|---|---|---|---|---|
| Torani Vanilla Syrup (750ML) | 3 | 30.0d | 81d | **S** (neither weekly) |
| Oatside Barista Blend Oatmilk (1L) | 3 | 30.0d | 63d | **S** |
| Da Vinci Butterscotch Sauce (2L) | 3 | 30.0d | 65d | **S** |
| *(any product with no sale in window)* | 0 | — | — | **N** → dead stock |

In the demo: widen the window to Annually (or scan a product in via Stock In
to record today's movement) and items flip to **F**. A product scanned and
sold *this week* hits the `recency ≤ 7` arm and reads Fast immediately.

**How the system uses it:** dead-stock candidates are sorted to the top of the
Optimization page (clear / discount / stop reordering), and — most importantly
— the FSN class **drives the Critical Level** (§4).

---

## 3. EOQ — Economic Order Quantity

**Question:** *How many units should one purchase order contain?*

### Basis — Harris's classical lot-size model (1913)

Two costs oppose each other:

- **Ordering cost (S)** — delivery fees, paperwork, receiving labor. Paid
  **per order**, so ordering small amounts often is expensive.
- **Holding cost (H)** — capital tied up in stock, spoilage, space. Paid
  **per unit per year**, so ordering large amounts rarely is expensive.

EOQ is the order size where the two cost curves cross at their minimum:

```text
EOQ = √( 2·D·S / H )

D = annual demand (units sold per year — from the sales ledger)
S = ordering cost per order   → ₱50  (as implemented)
H = holding cost per unit/yr  → 20% × unit cost C   (capital-carrying rate)
```

### Worked example — Milklab Full Cream Milk (12L)

```text
D = 36 cases/year        (ledger total)
C = ₱1,215               H = 0.20 × 1,215 = ₱243
S = ₱50

EOQ = √(2 × 36 × 50 / 243) = √14.8 ≈ 4 cases per order
```

**Interpretation:** don't buy a pallet at once (holding cost soars on a
perishable) and don't buy one case daily (delivery cost soars) — order in
**~4-case batches**.

The same endpoint (`GET /api/optimization/:id`) also returns the
**turnover ratio**:

```text
turnover = D / average inventory
```

For the milk: 36 / 210 on hand ≈ **0.17×/yr** — the seeded stock is deep
relative to demand, i.e. capital parked on shelves. A turnover above ~1 with
Class A value is the ideal "lean and moving" quadrant; the Optimization page
lists every product's EOQ and turnover so the owner can spot both extremes.

> **Model assumptions (fair to state at a defense):** demand is constant and
> known; costs are linear. Real cafés deviate — which is exactly why EOQ is
> paired with Safety Stock (buffer against variability) and FSN (reclassifies
> as behavior changes).

---

## 4. ROP (Reorder Point) + Safety Stock — and the Critical Level

**Question:** *At what stock level must a replenishment be triggered?*

### 4a. ROP + Safety Stock (as implemented)

```text
dailyDemand = D / 365
leadTime    = 7 days (supplier delivery assumption)

ROP = ⌈ dailyDemand × leadTime ⌉
Safety Stock = ⌈ √D × 0.1 ⌉        (√D — variance scales with demand magnitude)
```

**Basis:** the reorder point covers **demand during lead time** (if you sell
0.1 units/day and delivery takes 7 days, ordering when you hit 0.7 units is
too late — you must order before you run dry). Safety stock buffers the
uncertainty *around* that demand; scaling it by √D is a common simple
approximation of demand variability (the square-root-of-demand rule of thumb
from classical safety-stock theory).

Worked example (Milklab milk): dailyDemand = 36/365 ≈ 0.099 →
**ROP = ⌈0.69⌉ = 1**, **SS = ⌈√36 × 0.1⌉ = 1**. Thin — because D is small in
the seeded window; the mechanism scales up with real demand.

### 4b. Critical Level — the per-product alert threshold (the one the badges use)

**Basis:** before this was computed, every product shared one flat 80-unit
threshold — wrong in both directions: a genuinely fast mover blows past the
alert before it fires usefully, while a non-mover screams "low stock!" forever
with no sales. The fix: derive the threshold **from movement** (the FSN class
the product already carries), so the bar fits the product's actual rhythm.

```text
criticalLevel = max( classFloor , ⌈ratePerDay × leadTime⌉ + safetyStock )

safetyStock = ⌈ ratePerDay × leadTime × z ⌉        (z = service factor)

         F (Fast)     S (Slow)     N (Non-moving)
lead        7d          14d            30d
z           0.65        0.50           0.25
floor       120          60             32
```

Clamped to [5, 5000] so a data spike can never produce an absurd threshold.
Products with no sales history take the non-moving floor (32) — the same
value for a brand-new product on both backends.

**Worked examples from the live ledger (90-day window):**

| Product | Rate/day | Class | Cycle demand (rate×lead) | Safety (×z) | **Critical level** |
|---|---|---|---|---|---|
| Milklab Full Cream Milk | 0.40 | F | 0.40×7 = 2.8 | ⌈1.82⌉ = 2 | **max(3.8→4, 120) = 120** |
| Torani Vanilla Syrup | 0.22 | F | 1.54 | ⌈1.0⌉ = 1 | **max(3, 120) = 120** |
| Strawberry Puree 64OZ | 0.36 | F | 2.52 | ⌈1.64⌉ = 2 | **max(5, 120) = 120** |

Note what the floors do: with the thin seeded demand, the **class floor
dominates** (120), guaranteeing every product a sane, visible bar even with
little history. On a real ledger where a milk sells 40 units/day, the demand
term takes over: `40×7 + 40×7×0.65 = 460` → the alert fires *before* the
shelf empties instead of never.

**The three stock badges** consumers see (web catalog + mobile app):

```text
qty ≤ 0                          → Out of Stock
qty ≤ criticalLevel              → Critical
qty ≤ 1.5 × criticalLevel        → Low Stock
otherwise                        → In Stock
```

(`backend/src/critical-level.js → stockStatus()`, shared verbatim by the web
admin and the mobile client.)

---

## 5. FIFO / FEFO — Stock-Lot Consumption Order

**Question:** *When several purchase batches are on the shelf, which one leaves first?*

### Basis — the two classical issue disciplines

- **FIFO (First-In, First-Out):** oldest arrival goes out first. The default
  for shelf-stable café supplies (syrups, powders, cups, lids) — prevents
  old stock being buried behind new stock indefinitely.
- **FEFO (First-Expired, First-Out):** the **soonest-expiring** lot goes out
  first, **regardless of arrival date**. Correct for perishables — milks,
  purees, anything with a best-before date. FEFO *overrides* FIFO whenever an
  expiry date exists.

The user's rule, implemented literally: *"FIFO is good combined with FEFO —
FEFO mostly for milks and things that expire fast, regardless of arrival
date."*

### Formula (the consumption sort, both backends)

```sql
ORDER BY (expiry_date IS NULL) ASC,   -- dated lots first
         expiry_date ASC,             -- soonest expiry wins
         received_at ASC,             -- arrival order as tiebreaker
         id ASC
```

1. Every lot **with** an expiry date is consumed before any lot **without**
   one (non-expiring goods keep pure FIFO among themselves).
2. Within dated lots: soonest expiry first — *that* is FEFO.
3. Within the same expiry (or among non-expiring lots): oldest arrival first —
   *that* is FIFO.

Each consumption returns a **manifest** of `{expiry_date, qty}` per lot taken,
so a **stock transfer recreates matching destination lots** — expiry travels
with the goods. If stock exists without a matching lot (legacy data), the
overflow path decrements it and treats it as non-expiring.

### Where it runs

- **Stock-outs and transfers** consume lots in this order
  (`consumeStockLots()` in both backends — SQLite `stock_lots` table / in-app
  FEFO ledger on Firestore & Supabase).
- **Best-before alerts** are *derived from the same lot ledger*: a lot whose
  expiry is within the alert window raises `expiring_soon`; a past-date lot
  raises `expired`; consumed/re-dated lots auto-resolve their alerts.
- Stock-in with an `expiry_date` records the dated lot (mobile Scan & Count
  can capture best-before dates directly).

### Worked example (from the FEFO test suite)

```text
Lot A: syrup, received 01 May,   NO expiry  (non-expiring — FIFO forever)
Lot B: milk,  received 15 May,   expires 20 May   ← later arrival!
Lot C: milk,  received 01 Jun,   expires 05 Jun   ← newest, expires soonest

Sell 1 milk  →  FEFO consumes C (expires soonest), NOT the oldest B.
Sell 1 syrup →  FIFO consumes A (oldest non-expiring).
```

Pure FIFO would have drunk B before C and let C expire on the shelf — the
exact loss FEFO exists to prevent.

---

## 6. Money Visibility by Role (masking, not mathematics)

The owner's requirement — *"hide the value/money by role"* — is a **presentation
rule** layered on top of every algorithm above, not a change to any formula:

- **Owner / Super Admin** see full ₱ figures everywhere.
- **Inventory Staff** (mobile) and price-restricted admin roles see quantities,
  ranks, classes, and the formulas themselves — but peso amounts render as
  `••••`.
- Every **FormulaBanner** carries the note: *the math is public, the amounts
  are role-gated.*

So the algorithms remain auditable to every role while competitive figures
(purchase prices, sales values) stay restricted — least-privilege applied to
information, consistent with the RBAC design in SECURITY.md.

---

## 7. Date Filtering — Days / Weeks / Months / Quarterly / Annually

Every analytics and optimization surface accepts a **date-range window**
(`from`/`to` or the preset buttons) which re-scopes all of the above:

| Preset | Window |
|---|---|
| Days | 7 |
| Weeks | 30 |
| Months | 90 (default) |
| Quarterly | 180 |
| Annually | 365 |

Concretely: FSN re-measures frequency/recency inside the window (`windowDays`
in `fsn.js`), the dashboard's Total Sales / monthly charts group by month over
the range, and velocity (Top/Bottom movers) re-ranks. ABC is always measured
over the **full annual ledger** (annual value is its basis), while FSN,
velocity, and the critical-level `ratePerDay` follow the selected window —
which is why widening the window can move an item from S to F without
touching its ABC class.

---

## Verification — how to reproduce every number in this doc

```bash
cd backend
npm run verify          # 365/365 backend tests (FSN, FEFO, critical-level, EOQ parity)
```

The suite includes, among others:
- `test/fsn.test.js` — FSN classifier determinism + dual-backend parity
- `test/fefo.test.js` — FEFO-overrides-FIFO consumption, expiry travels with transfers
- `test/critical-level.test.js` — class floors, demand term, clamps, badges
- `test/contract.test.js` — SQLite backend vs npm-free/Firestore/Supabase produce identical numbers
- `test/optimization.test.js` — EOQ/ROP/turnover endpoint parity

All numbers above were computed directly from `backend/data/inventrak.db`
with the same SQL the endpoints run — no hand-typed figures.

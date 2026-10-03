# ALGORITHMS.md — Decision-Support & Pricing Algorithms in INVENTRAK

Every calculation the system uses to turn raw inventory, sales and cost data into
decisions — with the **basis**, the **formula as implemented**, a **worked example
from the deterministic seeded dataset**, and **how to show it to a panel without
opening the source**.

Every number below is reproducible from a clean clone:

```bash
cd backend
npm run seed     # deterministic: fixed-seed PRNG -> identical 612-row ledger
npm run verify   # 497/497
```

---

## ⚡ How to show this without showing the code

This is the section to rehearse. **None of these algorithms require showing
source.** Each one is visible in the running app — the formula renders *beside*
its own numbers, and the per-product "Why?" tooltip shows the exact inputs that
produced a single classification.

| # | Algorithm | Show it here | What to say |
|---|---|---|---|
| 1 | ABC classification | **Optimization → ABC tab** | "37% of my items make 70% of my value. The banner shows the rule; the tooltip shows this product's exact inputs." |
| 2 | FSN analysis | **Optimization → FSN tab** | "Same product, different question — ABC is *value*, FSN is *movement*." |
| 3 | EOQ | **Optimization → EOQ/ROP panel** | "This is how many cases per order." |
| 4 | ROP + safety stock | Same panel; **stock badges** | "This is when to trigger." |
| 5 | Critical level | **Inventory page**, badges (web + mobile) | "Per-product, not one flat number." |
| 6 | FIFO / FEFO | **Scan & Stock** — pick a dated lot | "The expiring lot leaves first. Watch the batch number change." |
| 7 | Turnover ratio | **Optimization page** | "Capital parked on shelves." |
| 8 | Target-margin pricing | **Products → Margin overview** | "This price buys the 30% target. One click applies it." |
| 9 | Cost normalization | **Products → Bulk sheet → supplier rate** | "Type one supplier rate, fill 102 costs." |
| 10 | Three-state cost parse | **Products → Bulk sheet → Parse preview** | "A blank cell is *not* a clear. Here's why that matters." |
| 11 | Immutable costing snapshot | **Order Inquiries → any submitted order** | "Reprice the catalog; this order's profit did not move." |
| 12 | Customer identity resolution | **Reports → per-customer history** | "612 legacy sales, now grouped into 3 real customers." |
| 13 | RBAC tier wall | Log in as **staff**, then as **admin** | "Same button, different role, different outcome." |
| 14 | Exponential-backoff lockout | Fail a login 5× | "Wait time doubles each breach." |
| 15 | TOTP / MFA | **Security → Enable MFA** | "RFC 6238, server-verified." |

**If a panel member asks "prove it"** — the strongest single move is the
**cross-backend contract test**: the SQLite backend and the npm-free/Firestore/
Supabase backend are *different implementations* of these algorithms, and
`npm test` asserts they return **byte-identical numbers**. Same algorithm, two
engines, same answer. That is a correctness argument that no screenshot gives
you.

---

## Algorithm map — how they feed each other

```
sales_transactions ledger
        │
        ├──► ABC ───────────────── "WHAT matters?"      (value)
        ├──► FSN ───────────────── "WHAT is moving?"    (frequency + recency)
        │         │
        │         └──► Critical Level "WHEN to alert?"  (per-product threshold)
        │
        └──► EOQ ───────────────── "HOW MUCH to order?"  ROP/Safety Stock ── "WHEN?"

stock_lots ──────► FIFO / FEFO ─── "WHICH batch leaves?"
product sizes ───► Normalization ─► "COST per 100 ml/g/piece" ─► Target margin ─► Price
```

---

# PART A — Replenishment (the classic inventory algorithms)

## 1. ABC Classification

**Question:** *Which products deserve the tightest monitoring?*

### Basis — the Pareto principle

A classical inventory observation: **a small share of items creates most of the
value**. ABC ranks products by total sales value, walks the ranking accumulating
a share of the total, and cuts at conventional breakpoints. (Named for Vilfredo
Pareto's income distribution; popularised in quality management as the 80/20
rule by Joseph Juran. *If a panel asks for a primary source, cite your textbook —
this doc deliberately does not invent a page number.*)

- **Class A** — inside the first **70%** of cumulative value → the vital few.
  Tight control, frequent counts, priority replenishment.
- **Class B** — 70%–**90%** → normal control.
- **Class C** — the tail → loose control, bulk orders.

### Formula (as implemented — `backend/src/routes/optimization.js`)

```text
annualValue(p) = Σ sales_transactions.total_amount  WHERE product_id = p
sort DESC by annualValue;  total = Σ annualValue
cumShare(p) = (Σ value of 1..p) / total

Class = A if cumShare ≤ 70
      = B if 70 < cumShare ≤ 90
      = C otherwise
```

### Live result — the Pareto shape appears on its own

| Class | Items | Share of catalog | Share of value |
|---|---|---|---|
| **A** | **76** | **37%** | **69.8%** |
| **B** | 53 | 26% | 20.1% |
| **C** | 75 | 37% | 10.2% |

**Thirty-seven percent of the catalog produces seventy percent of the value.**
Nobody was told to make that happen; it is what falls out of the ranking.

### The A-list top 7 (every figure below is the endpoint's own output)

| Rank | Product | Annual value | Units | Cum. share | Class |
|---|---|---|---|---|---|
| #1 | Nutella Ferrero Food Service (3KG) | ₱68,635 | 37 | 2.7% | A |
| #2 | Lotus Biscoff Smooth Spread (3KG) | ₱66,250 | 25 | 5.2% | A |
| #3 | Strawberry Puree 64OZ | ₱60,000 | 30 | 7.6% | A |
| #4 | Torani Strawberry Puree Blend (64OZ) | ₱56,000 | 28 | 9.8% | A |
| #5 | DLA Pistachio Filling (1KG) | ₱54,366 | 26 | 11.9% | A |
| #6 | Da Vinci Caramel Sauce (2L) | ₱44,940 | 42 | 13.6% | A |
| #7 | Da Vinci White Chocolate Sauce (2L) | ₱38,520 | 36 | 15.1% | A |

**Why spreads and fillings outrank milk.** ABC ranks by *value × frequency*, not
by unit price. A café buys chocolate spread and nut filling constantly; the
₱1,855 Nutella is not the top item because it is expensive, but because it sells
**37 cases**. Contrast the tail: **Oatbedient Artisan Oatmilk Barista (₱520,
rank #202)**, **Marie Condensada (₱642, #203)**, **Milklab Oat Milk (₱656, #204)**
— all C.

**The nuance worth saying out loud:** condensed milk is still *milk*, but its
pack and price keep it in C. **ABC ranks by what sells, not by what it is.**

> **Note:** `Milklab Full Cream Milk (12L)` sits at **rank #12, ₱36,450,
> cum. share 22.3%** — A-class, but outside the top 7.

---

## 2. FSN Analysis (Fast / Slow / Non-moving)

**Question:** *Is the product actually moving?*

### Basis — usage-rate classification

Where ABC ranks by **value**, FSN ranks by **movement** — how *often* a product
sells and how *recently* it last sold. A widely-used retail and pharmacy
technique, in the VED/FSN family. *(The classification is standard industry
practice; cite your textbook for the primary source rather than trusting a
specific attribution here.)*

The pair is complementary and the combinations are the actual insight:

| | Fast (F) | Slow (S) | Non-moving (N) |
|---|---|---|---|
| **Class A** | ★ protect — the core business | review price / range | **investigate — high value, dead stock** |
| **Class C** | fine | minor | ignore |

### Formula (as implemented — `backend/src/fsn.js`)

```text
transactions = count of sales inside the window
frequency    = clamp( window / transactions, 1 … window )   // avg days between sales
recency      = today − date of last sale                      // days
ratePerDay   = totalQty / window

N = zero transactions in the window                        → dead stock
F = frequency ≤ 7 days  OR  recency ≤ 7 days
S = everything else
```

**Why 7 days:** café supplies run on a *weekly* replenishment rhythm. An item
that hasn't sold this week, and doesn't average weekly sales, is not flowing.
The `OR` is deliberate — **recency rescues genuinely popular items whose average
interval is skewed by one early sale.** Da Vinci Caramel Sauce below is exactly
that case: average interval 30 days, but it sold 4 days ago, so it is Fast.

The page sorts **N → S → F** so the dead stock the owner must act on surfaces first.

### Live result — 90-day window, measured 2026-10-03

| Class | Products |
|---|---|
| **F** (Fast) | 86 |
| **S** (Slow) | 93 |
| **N** (Non-moving) | 25 |

| Product | Txns | Frequency | Recency | Class | Why |
|---|---|---|---|---|---|
| Da Vinci Caramel Sauce (2L) | 3 | 30.0d | **4d** | **F** | recency ≤ 7 fires, despite a 30-day average |
| Nutella Ferrero Food Service (3KG) | 3 | 30.0d | **2d** | **F** | same — sold this week |
| Oatbedient Artisan Oatmilk Barista | 0 | — | — | **N** | no sale in the window |
| Acc Caramel Syrup (1KG) | 0 | — | — | **N** | no sale in the window |

> ⚠️ **Reproducibility caveat — state this if challenged.** ABC is
> time-invariant: it reads the whole ledger, so the numbers above are exact and
> reproducible forever. **FSN is time-*dependent*** — `recency` is measured
> against the current date, so classes shift as the calendar moves. That is
> correct behaviour, not a bug; the date above is stamped for that reason.

**To see F flip live:** widen the window to Annually, or scan a product in via
Stock In to record today's movement — it hits the `recency ≤ 7` arm immediately.

---

## 3. EOQ — Economic Order Quantity

**Question:** *How many units should one purchase order contain?*

### Basis — the Harris classical lot-size model (1913)

Two costs oppose each other:

- **Ordering cost (S)** — delivery, paperwork, receiving labour. Paid **per
  order**, so ordering small amounts often is expensive.
- **Holding cost (H)** — capital tied up, spoilage, space. Paid **per unit per
  year**, so ordering rarely in bulk is expensive.

EOQ is the order size where the two curves cross at their minimum.

> **Primary source (confident):** F. W. Harris, *"How Many Parts to Make When"*,
> Factory and Industrial Management, 1913.

### Formula (as implemented)

```text
EOQ = √( 2·D·S / H )

D = annual demand (units/year, from the ledger)
S = ordering cost per order  → 50  (constant, as implemented)
H = 0.20 × C                 (capital-carrying rate of 20%)
C = product.price
```

> **Honest modelling note — say this before a panel finds it.** `C` is the
> **selling price**, because the seeded catalog ships with `cost = NULL` for
> every product. In production, once costs are entered, holding cost should be
> derived from *cost*, not price — price is a revenue figure and capital is tied
> up in what the goods cost. The formula takes `C` as a parameter precisely so
> this is a one-line change.

### Worked example — Da Vinci Caramel Sauce (2L)

```text
D = 42 cases/year          (ledger total for this product)
C = ₱1,070                 H = 0.20 × 1,070 = ₱214
S = ₱50

EOQ = √(2 × 42 × 50 / 214) = √19.6 ≈ 4 cases per order
```

**Interpretation:** don't buy a pallet at once (holding cost soars on a
perishable) and don't buy one case daily (delivery cost soars) — order in
**~4-case batches**.

| Product | D | C | H | EOQ | Stock on hand | Turnover |
|---|---|---|---|---|---|---|
| Da Vinci Caramel Sauce (2L) | 42 | ₱1,070 | ₱214 | **4** | 190 | 0.22× |
| Nutella Ferrero Food Service (3KG) | 37 | ₱1,855 | ₱371 | **3** | 321 | 0.12× |
| Oatbedient Artisan Oatmilk Barista | 4 | ₱130 | ₱26 | **4** | 240 | **0.02×** |

Oatbedient is the one to point at: **0.02×/yr** — a ₱520 product sitting on 240
units of shelf. That is a number a panel can see is *obviously* wrong for a
healthy business, and the system reports it without being asked.

> **Model assumptions (fair to state at a defense):** demand is constant and
> known; costs are linear; no quantity discounts. Real cafés deviate — which is
> exactly why EOQ is paired with Safety Stock (buffer against variability) and
> FSN (reclassifies as behaviour changes).

---

## 4. ROP + Safety Stock, and the Critical Level

**Question:** *At what stock level must replenishment be triggered?*

### ROP + Safety Stock (as implemented)

```text
leadTimeDays = 7
ROP          = ⌈ (D / 365) × leadTimeDays ⌉
safetyStock  = ⌈ √D × 0.1 ⌉
```

For Da Vinci Caramel Sauce: `ROP = ⌈0.115⌉ = 1`, `SS = ⌈√42 × 0.1⌉ = ⌈0.65⌉ = 1`.

> **State the limitation:** a 7-day lead time and a 10%-of-demand buffer are
> *parameters*, not derived facts — the business has not supplied real supplier
> lead times. They are exposed as named constants precisely so they can be
> replaced with measured values.

### Critical Level — the per-product threshold (what the badges actually use)

Before this, every product shared one flat **80-unit** threshold — wrong in both
directions: a fast-moving milk selling 40/day hits empty long before an 80-unit
alert fires, while a display piece raises a false alarm forever. The critical
level is therefore derived per product from its own FSN classification.

### Formula (`backend/src/critical-level.js`, exact)

```text
cycleDemand  = ratePerDay × LEAD_TIME_DAYS[class]
safetyStock  = ⌈ cycleDemand × SERVICE_FACTOR[class] ⌉
demandLevel  = ⌈ cycleDemand ⌉ + safetyStock

criticalLevel = clamp( max(demandLevel, CLASS_FLOOR[class]), MIN_LEVEL, MAX_LEVEL )
```

| Class | Lead time (days) | Service factor | Class floor |
|---|---|---|---|
| **F** Fast-moving | 7 | 0.65 | 120 |
| **S** Slow-moving | 14 | 0.50 | 60 |
| **N** Non-moving | 30 | 0.25 | 32 |

`MIN_LEVEL = 5`, `MAX_LEVEL = 5000` — the absolute clamp, so a data spike can
never produce an absurd threshold.

**Worked example — a fast mover selling 40/day** (the motivating case):

```text
cycleDemand = 40 × 7 = 280
safetyStock = ⌈280 × 0.65⌉ = 182
demandLevel = 280 + 182      = 462
criticalLevel = max(462, 120) = 462      → comfortably above the old flat 80
```

**Why it matters:** it is movement-aware, so the same alert means different
things for different products — which is exactly the criticism the flat threshold
deserved. The `CLASS_FLOOR` is what keeps a brand-new product (no sales history)
at an orderable threshold instead of zero, and the badge ladder is:

```text
qty ≤ 0              → out_of_stock
qty ≤ criticalLevel  → critical
qty ≤ ⌈level × 1.5⌉  → low_stock     (1.5× is owner-tunable; ≤1 is refused)
otherwise            → in_stock
```

> The widening factor comes from live System Settings. A factor of 1 or less is
> **rejected**, because it would collapse the "low" band onto the critical level
> and make the badge unreachable.

---

## 5. FIFO / FEFO — Stock-Lot Consumption Order

**Question:** *Which batch leaves the shelf first?*

### Basis — the two classical issue disciplines

- **FIFO** (First-In, First-Out) — consume in arrival order. Correct when value
  decays with age.
- **FEFO** (First-Expired, First-Out) — consume the batch with the **earliest
  expiry** first. Correct where the product *becomes unsellable* with age.

For a café, perishable dairy and syrups make **FEFO** the governing rule and FIFO
the fallback for non-dated stock. FEFO is standard practice in food safety and
pharmaceutical inventory management, where the expiry date is a regulatory fact
rather than a preference.

### Formula (the consumption sort, identical in both backends)

```text
sort lots by:
   1. lots WITH an expiry date, earliest first
   2. lots WITHOUT an expiry date
   3. within each group, earlier arrival first  (FIFO tiebreak)

then consume greedily down the sorted list.
```

Each consumption emits a **manifest** — `[{ expiry_date, qty }, …]` — which is
what lets a *transfer* recreate matching destination lots. **The expiry travels
with the goods**, so moving stock between branches cannot silently reset its
best-before date.

---

# PART B — Pricing & Costing (the INVENTRAK-specific algorithms)

These are not textbook inventory algorithms; they are the decisions this system
makes that a spreadsheet cannot.

## 6. Target-Margin Pricing

**Question:** *What price buys a target margin, and which products are below it?*

### Basis — gross margin on price, solved algebraically

Gross margin is defined on the **selling price**, not on cost:

```text
margin% = (price − cost) / price
```

Setting `margin = t` and solving for price gives the price that achieves it:

```text
price = cost / (1 − t/100)
```

> The common mistake is `price = cost × (1 + t)` — that yields the margin *on
> cost*, not on price, and undershoots the target. Worked: at C = ₱330 and
> t = 30%, the naive formula gives ₱429, which is a **23.1%** margin — 6.9 points
> short. The correct price is ₱471, so the mistake costs **₱42 per unit**.

### The rounding detail worth defending

The suggestion is `⌈cost / (1 − t/100)⌉` — **rounded up, not to nearest.**
Rounding to nearest lands *below* the target whenever the exact figure is
fractional (cost ₱850 at 30% → 1214.28 → **1214**, a 29.98% margin). The row
would stay flagged as under-priced forever while a reprice reported success.
Rounding up guarantees the suggestion clears the very threshold that flagged it.
`frontend-admin/src/reprice.test.js` replays the write and asserts the list
empties.

### Live result

3 costed products in the demo dataset, all below the 30% target, each with the
price that fixes it. **The margin overview also flags cost ≥ price (loss-makers)
separately** — at a 0 count today, and that count is the honest state.

---

## 7. Cost Normalization — one supplier rate → a costed catalog

**Question:** *Suppliers quote "₱___ per litre". The catalog stores per-bottle
cost. How do they connect?*

### Basis — unit normalisation onto a common basis

Products are priced and costed **per single unit**, so a 1kg bag and a 750ml
bottle are not comparable: both read "margin 40%" and neither tells you which
earns more per litre. Normalisation divides both price and cost by the same
quantity onto a common basis.

> Scaling price and cost by the *same* factor cannot change a margin
> percentage — so this is for **comparability across sizes**, not for changing
> the answer about any one product.

| Dimension | Common basis | Source fields |
|---|---|---|
| volume | per 100 ml | `750 ML`, `2 L`, `1.89 L`, `cl`, `dl` |
| weight | per 100 g | `1 KG`, `610G`, `16.5 OZ`, `lb` |
| count | per **piece** | `50PCS`, `unit = bottle/can/box` |

### The bug this design guards against — say it, it is your best point

**`kg` and `l` are both 1000.** A lookup that returns only a multiplier cannot
tell them apart, and reports a **kilogram of chocolate as a litre of syrup** —
which then gets costed at a per-litre rate and reports success. The parser
therefore carries the **dimension** with every factor, not just the number.

### Conservative by construction

A wrong parse is worse than no parse: it writes a fabricated cost and makes every
margin downstream confidently wrong. So the parser returns `null` whenever the
text is ambiguous, and unreadable products get a **blank** cost cell — which the
cost sheet already reads as *"leave this product alone"*. A bad parse degrades to
**"still uncosted"**, never to **"a made-up cost"**.

Deliberately **not** done: converting a ₱/kg figure to ₱/L (different commodities,
different densities — that would be invented, not measured), and word-form
multipacks ("dozen of 250ml" — only numeric `6 x 250ml` is recognised).

### Live result

| Dimension | Products | Reading |
|---|---|---|
| volume | 102 | ₹ per 100 ml |
| weight | 50 | per 100 g |
| count | 17 | per piece |
| **no size recorded** | **35** | excluded — the panel names this count |

169 of 204 products are readable. **The 35 without a size are reported, not
silently skipped** — adding a size to a product brings it into the rate.

---

## 8. The Three-State Cost Parse

**Question:** *In a pasted sheet, what does a blank cost cell mean?*

### Basis — ambiguity must resolve to the safe reading

A cost sheet needs three instructions — *set this*, *clear this*, *ignore this* —
and they must not collapse into each other:

| Input | Meaning | Why |
|---|---|---|
| `380` | **set** the cost to 380 | unambiguous |
| `-` / `clear` / `none` | **clear** to "not costed" | spelled out deliberately |
| *(blank)* | **leave alone** | ⚠️ the safe default |
| `abc` | **junk — report it** | never silently 0 |

**Why blank must mean "leave alone":** defaulting blank → clear is the
catastrophic reading. An admin who downloads the current cost sheet, fills in
four products, and re-uploads would **silently wipe the other 200 real costs** —
and the response would still report success.

This is mirrored exactly in the server contract (`backend/src/costing.js`), the
admin sheet (`frontend-admin/src/cost-sheet.js`) and the CLI script
(`backend/scripts/backfill-costs.js`) — one rule, three implementations, all
tested against the same cases.

**The sibling trap:** `Number('') === 0`. An unreduced cell is *junk*, not a free
product. This has been hit three times in this codebase — in the cost sheet, in
the CLI parser, and in the normalisation module. Each is now guarded and tested.

---

## 9. Immutable Costing Snapshot

**Question:** *A past order quotes a profit. The catalog changes. Which is true?*

### Basis — derived figures must be frozen at the moment of decision

An inquiry's stored `estimated_cost` is recomputed from live line subtotals, so
reprice a product today and **last month's order silently reports a different
profit**. A quote given to a customer must not be retroactively rewritten.

The system writes an immutable `costing_records` row at submission —
`UNIQUE(inquiry_id)`, never updated — carrying `total_cost, total_revenue,
cost_per_cup, suggested_selling_price, estimated_profit, cost_basis`.

> **Defensible property:** `cost_basis` distinguishes a *measured* cost from an
> *assumed* one. An uncosted product reports `cost_basis: "none"` — a null, not a
> zero. Conflating those two is what makes an uncosted catalog look like a
> business in trouble.

**Live demo:** open any submitted order, then reprice its product, then reopen the
order. The figures do not move.

---

## 10. Customer Identity Resolution

**Question:** *612 legacy sales rows carry only a free-text name. Whose are they?*

### Basis — deterministic entity resolution with a strict identity order

```
user_id  →  email  →  name  →  (nothing)
```

A candidate is matched in that order, first match wins. If none applies, the row
is **left unlinked** — the system never invents a person to make a total add up.
This is the same shared module (`backend/src/customers.js`) on both backends, so
the answer cannot differ between them.

**Why it matters:** every customer attribute used to be smeared across
`order_inquiries` (name/email/phone, once per order) and `sales_transactions`
(free-text name). "This customer's history" was **unanswerable** — two orders
from the same person typed slightly differently look like two people.

**Live result:** the 612 seeded sales resolve to **3 real customers** —
Juan Dela Cruz (₱855,968), Maria Santos (₱865,167), Jose Rizal (₱849,928), 204
sales each — via `npm run customers:backfill`: dry-run by default, idempotent,
and it re-reads before reporting success so the verification cannot report a
stale result. Those three figures sum to the ₱2,571,063 ledger total above, which
is the cheapest way to check them: if they don't add up, one of them came from a
different database.

---

# PART C — Security algorithms

## 11. The RBAC Tier Wall

**Question:** *What does "admin only" actually mean?*

### Basis — role hierarchies with least privilege, enforced server-side

```
customer <  staff <  admin <  super_admin
                        └── owner (full oversight + authorises access decisions)
```

Enforced in the **backend**, not the UI — the phone apps are thin and make no
authorisation decisions. `cost` is stripped from *every* non-admin product read
(**unconditionally**, because the public catalog is CDN-cacheable and a
role-dependent payload could be served to an anonymous visitor from a shared
cache).

**Live demo:** log in as `staff` and open the cost endpoints. 403. The button is
hidden in the UI *and* the wall holds server-side — the panel can test either.

## 12. Exponential-Backoff Login Lockout

### Basis — throttling a sustained attack harder over time

Per `(username, source-IP)`: count failures in a sliding window; on breach, lock
the account for a duration that **doubles** per successive breach, capped. A
single typo costs nothing; a sustained attack is throttled progressively. Success
clears the counter immediately.

## 13. TOTP / MFA

### Basis — RFC 6238 (time-based one-time passwords)

6-digit codes derived from `⌊(T − T₀)/X⌋` with HMAC-SHA-1, **server-verified**
with a replay window. Secrets are stored hashed; recovery codes are single-use
and hashed too, so a database leak yields neither.

> Primary source (confident): **RFC 6238**. Related: **RFC 7519** (JWT),
> **RFC 2104** (HMAC).

---

## Verification — reproduce every number in this document

```bash
cd backend
npm run verify      # 497/497 across 51 suites
```

| Claim in this doc | Suite that locks it |
|---|---|
| FSN classification + dual-backend parity | `src/test/fsn.test.js` |
| FEFO overrides FIFO; expiry travels with transfers | `src/test/fefo.test.js` |
| Critical level: floors, clamps, badge ladder | `src/test/critical-level.test.js` |
| ABC endpoint parity across drivers | `src/test/contract.test.js` |
| Three-state cost parse | `src/test/costing.test.js`, `src/test/bulk-costs.test.js` |
| Normalisation never conflates kg with L | `frontend-admin/src/cost-normalize.test.js` |
| Reprice clears the under-priced list | `frontend-admin/src/reprice.test.js` |
| Customer identity order | `src/test/customers.test.js`, `src/test/backfill-scripts.test.js` |
| Maintenance scripts, Supabase + SQLite | `src/test/supabase-rest.test.js` |
| Role wall / cost confidentiality | `src/test/roles.test.js`, `src/test/security.test.js` |
| Lockout backoff | `src/test/login-lockout.test.js` |

### Reproducing the dataset figures

```bash
cd backend
INVENTRAK_DB_PATH=$(mktemp -d)/clean.db node -e "
  const {db}=require('./src/db');
  const {seedDatabase}=require('./src/seed');
  seedDatabase({db});
  console.log(db.prepare('SELECT COUNT(*) n FROM sales_transactions').get().n);   // 612
  console.log(db.prepare('SELECT ROUND(SUM(total_amount)) v FROM sales_transactions').get().v); // 2571063
"
```

The seeder uses a **fixed-seed PRNG** (`backend/src/prng.js`) and a fixed draw
order shared by the SQLite and npm-free backends, so this reproduces
**byte-identically** on any machine, any day. That is itself a defensible claim:
*the demo data is reproducible, not hand-typed.*

> **Do not compute these from `backend/data/inventrak.db`.** That file drifts as
> the app is used. The committed catalog is `backend/data/products.json`, and
> `npm run seed` is what regenerates a known state.

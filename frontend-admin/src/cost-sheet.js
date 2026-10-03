// Cost-of-goods sheet logic for the admin console.
//
// WHY THIS IS ITS OWN MODULE
// The bulk PRICE panel predates costing and its parser lives inline in
// ProductsPage. Costs cannot reuse it, for one reason that matters more than
// tidiness: on a price sheet a blank cell is unambiguously junk, because price
// is required for a product to exist. On a cost sheet a blank cell has at
// least two very different meanings, and guessing between them either destroys
// data or lies about it:
//
//   "I did not get to this row"      -> leave the existing cost alone
//   "This product is not costed"     -> clear the cost back to null
//
// Defaulting a blank to "clear" is the dangerous one: an admin who downloads
// the current cost sheet, fills in four new products and re-uploads would
// silently wipe the other 200 real cost values, and the response would still
// report success. So the safe reading wins — a blank cell means LEAVE ALONE,
// and clearing must be spelled out ("-" or "clear"). The preview states both
// counts before anything is written, so the destructive reading is never
// implicit.
//
// This mirrors the server contract in backend/src/costing.js parseCostEntry:
// an absent `cost` key skips, null clears, a number sets.

// Tokens a user can type in the Cost column to mean "clear this deliberately".
const CLEAR_TOKENS = new Set(['-', '--', 'clear', 'none', 'null', 'n/a', 'n/a']);

const HEADER_WORDS = /^(name|product\s*name|cost|costs|id|price|sku|product)$/i;

// A currency symbol plus a 1-3 digit group, with no decimal part: the shape a
// thousands separator takes when the CSV writer could not quote it.
const CURRENCY_FRAGMENT = /^[₱$€£]\s*\d{1,3}$|^\d{1,3}[₱$€£]$/;

// Parse pasted/uploaded CSV text into [{ id?, name, cost }].
//
//   cost === number    -> set the cost to this value
//   cost === null      -> clear the cost ("not costed")
//   cost === undefined -> leave the product's current cost untouched
//
// Accepted layouts (header row optional):
//   Product Name,Cost
//   Product Name,Price,Cost     (a middle Price column is ignored)
//   id,name,cost
//   Name<TAB>Cost               (tab-separated, straight from Excel)
//   Name,1,234.50               (thousands separators and a peso sign are fine)
export function parseCostSheet(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  let isHeader = true;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const cols = line.includes('\t') ? line.split('\t').map(c => c.trim()) : splitCsvLine(line);

    // A thousands separator is indistinguishable from a column break, so
    // "Almond Roca,₱1,250.50" splits into three fields. Rejoin the last two
    // when the second-to-last is a currency symbol followed by a short digit
    // group — the shape of a thousands separator being carried as its own
    // column. A bare number there ("Name,520,380") is a real middle column
    // and is left alone.
    if (cols.length >= 3 && CURRENCY_FRAGMENT.test(cols[cols.length - 2])) {
      cols[cols.length - 2] = cols[cols.length - 2] + cols[cols.length - 1];
      cols.pop();
    }

    // 3+ columns is either id,name,cost or name,price,cost. They are told apart
    // by the first column: only the id form starts with a positive integer, so
    // a product legitimately named "7 Up" is not mistaken for a row id.
    const firstNum = Number(cols[0]);
    const hasId = cols.length >= 3 && Number.isInteger(firstNum) && firstNum >= 1;
    const name = String(hasId ? cols[1] : cols[0] || '')
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!name) continue;

    // Only the first non-empty line is allowed to be a header, and only when
    // the name column is exactly a header word.
    if (isHeader && HEADER_WORDS.test(name)) {
      isHeader = false;
      continue;
    }
    isHeader = false;

    const id = hasId ? firstNum : undefined;

    rows.push({ id, name, cost: cols.length < 2 ? undefined : parseCostCell(cols[cols.length - 1]) });
  }

  return rows;
}

// Split one CSV line into fields, honouring double quotes so a product name
// containing a comma ("Salt, Sea & Pepper,300") stays one field. Written out
// rather than regex-paired because a "split on the last comma that looks like a
// number" approach silently collapses the 3-column form — "Almond,520,380"
// becomes the name "Almond,520" with cost 380, and the Price column is
// indistinguishable from part of the name.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(c => c.trim());
}

// One Cost cell -> a number, null (clear), undefined (leave alone) or NaN
// (junk the admin must see).
function parseCostCell(cell) {
  const raw = String(cell === undefined || cell === null ? '' : cell).trim();
  // Blank: the user did not fill this in. Leave the product's cost alone.
  if (raw === '') return undefined;
  if (CLEAR_TOKENS.has(raw.toLowerCase())) return null;
  // Strip currency symbols and thousands separators; keep the first decimal
  // point only. '1,250.50' -> 1250.50, 'P1,250' -> 1250.
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  // Number('') is 0 — the same trap costing.js guards against, where an
  // uncosted product would silently become a zero-cost product. A non-blank
  // cell that reduces to no digits at all is junk, not a free item.
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return NaN;
  const n = Number(cleaned);
  // A negative or unparseable cell is NOT a clear and NOT a set — it is junk,
  // and is reported as skipped rather than guessed at. Note that a non-blank
  // cell that reduces to nothing ("abc") is junk too, not "leave alone":
  // silently ignoring a typo'd cost is how a catalog ends up quietly uncosted.
  // Zero stays a real value.
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

// Build the request body. Entries with no decision are dropped entirely so the
// server sees an absent `cost` key (skip) rather than a null (clear) — the
// distinction the whole module exists to protect.
export function toCostPayload(rows) {
  return (rows || [])
    .filter(r => r && r.cost !== undefined && !Number.isNaN(r.cost))
    .map(r => (r.id ? { id: r.id, name: r.name, cost: r.cost } : { name: r.name, cost: r.cost }));
}

// What the admin is about to do, before any of it is written.
// `catalog` is [{ name, price }] — enough to check name matching and to warn
// about a cost that is at or above the selling price.
export function summarizeCostSheet(rows, catalog) {
  const list = Array.isArray(rows) ? rows : [];
  const byName = new Map();
  for (const p of Array.isArray(catalog) ? catalog : []) {
    byName.set(String(p && p.name || '').trim().toLowerCase(), p);
  }

  const unmatched = [];
  const lossMakers = [];
  let willSet = 0;
  let willClear = 0;
  let willSkip = 0;
  let junk = 0;

  for (const r of list) {
    if (!r) continue;
    if (Number.isNaN(r.cost)) {
      junk += 1;
      unmatched.push({ name: r.name, reason: 'unreadable cost' });
      continue;
    }
    const product = r.id
      ? (Array.isArray(catalog) ? catalog.find(p => Number(p.id) === Number(r.id)) : null)
      : byName.get(String(r.name || '').trim().toLowerCase());
    if (!product) {
      unmatched.push({ name: r.name, reason: 'not in catalog' });
      continue;
    }
    if (r.cost === undefined) {
      willSkip += 1;
      continue;
    }
    if (r.cost === null) {
      willClear += 1;
      continue;
    }
    willSet += 1;
    const price = Number(product.price);
    // A cost at or above the selling price is almost always a data-entry slip
    // (the two columns transposed, or a peso sign read as part of the number).
    // Surface it rather than storing it: costing.js would faithfully report
    // zero or negative margin, which looks like a bug in the math.
    if (Number.isFinite(price) && price > 0 && r.cost >= price) {
      lossMakers.push({ name: r.name, cost: r.cost, price });
    }
  }

  return { total: list.length, matched: list.length - unmatched.length, unmatched, willSet, willClear, willSkip, junk, lossMakers };
}

// The CSV a user downloads to fill in Excel: current cost, and the selling
// price alongside it so the margin is visible while typing.
export function buildCostTemplate(catalog) {
  const rows = (Array.isArray(catalog) ? catalog : []).map(p => {
    const price = p.price === null || p.price === undefined ? '' : p.price;
    const cost = p.cost === null || p.cost === undefined ? '' : p.cost;
    return `${csvCell(p.name)},${price},${cost}`;
  });
  return 'Product Name,Price,Cost\n' + rows.join('\n');
}

function csvCell(value) {
  const s = String(value === null || value === undefined ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ============================================================
// Derived read-side helpers: coverage, margin, insights, diffs.
// ============================================================
// Everything above is about turning typed text into a write. Everything below
// turns the stored catalog back into an ANSWER — which is the half that was
// missing: the sheet could write costs but nothing could say what they were
// worth, or how many were left to do.
//
// All of it is a pure function of the catalog rows the page already loads, so
// it costs no extra request and can be tested without a server.

// Gross margin as a percentage, or null when it cannot be computed honestly.
// A product with no cost has NO margin — it is not a 0% margin product, it is
// an unknown one, and conflating the two is what makes an uncosted catalog
// look like a business in trouble. price <= 0 likewise yields null rather than
// dividing by zero.
export function marginPercentOf(product) {
  const cost = unitCost(product);
  if (cost === null) return null;
  const price = Number(product && product.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

// null when uncosted, otherwise the bucket.
export function marginBucket(product) {
  const pct = marginPercentOf(product);
  if (pct === null) return 'uncosted';
  if (pct < 0) return 'loss'; // cost above the selling price
  if (pct < 20) return 'thin';
  if (pct < 50) return 'healthy';
  return 'rich';
}

// The headline number the cost page was missing: how much of the job is left.
// Without it, "Total 204" is the only feedback after a bulk apply, and there is
// no way to tell whether the work is finished.
export function coverageOf(products) {
  const list = Array.isArray(products) ? products : [];
  const costed = list.filter(p => unitCost(p) !== null).length;
  return {
    costed,
    total: list.length,
    uncosted: list.length - costed,
    pct: list.length === 0 ? 0 : Math.round((costed / list.length) * 100),
  };
}

function unitCost(product) {
  if (!product) return null;
  const raw = product.cost;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// The per-row diff the CLI script prints and the browser UI used to omit, so
// the two tools disagreed about how much you could see before committing.
// `from` is what the product costs right now, `to` what this row would make it.
export function sheetDiff(rows, catalog) {
  const byId = new Map();
  const byName = new Map();
  for (const p of Array.isArray(catalog) ? catalog : []) {
    byId.set(String(p && p.id), p);
    byName.set(String(p && p.name || '').trim().toLowerCase(), p);
  }
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const product = r.id
      ? byId.get(String(r.id))
      : byName.get(String(r.name || '').trim().toLowerCase());
    if (!product) continue;
    out.push({
      id: product.id,
      name: product.name,
      from: unitCost(product),
      to: r.cost === undefined ? unitCost(product) : (r.cost === null ? null : r.cost),
      status: r.cost === undefined
        ? 'untouched'
        : (r.cost === null
          ? 'cleared'
          : (unitCost(product) === r.cost ? 'unchanged' : 'set')),
    });
  }
  return out;
}

// The margin intelligence panel's contents, as pure data.
//
// BLENDED MARGIN is value-weighted, not an average of percentages: summing
// costs and summing prices separately, then dividing. Averaging per-product
// margins would let a ₱60 cup of cups outweigh a ₱1,500 sack of syrup, and
// report a blended margin the business does not actually earn. The panel says
// "catalogue-wide" rather than "sales-weighted" because no quantity is stored
// on the product record — the honest denominator is list price, not turnover.
export function buildCostInsights(products, targetMarginPercent = 30) {
  const list = Array.isArray(products) ? products : [];
  const target = Number(targetMarginPercent) > 0 ? Number(targetMarginPercent) : 30;
  const costed = list.filter(p => unitCost(p) !== null);
  const byCategory = new Map();
  let sumCost = 0;
  let sumPrice = 0;

  for (const p of costed) {
    const price = Number(p.price);
    const cost = unitCost(p);
    if (!Number.isFinite(price) || price <= 0) continue;
    sumPrice += price;
    sumCost += cost;
    const key = String(p.category || 'Uncategorised');
    const agg = byCategory.get(key) || { category: key, costed: 0, cost: 0, price: 0 };
    agg.costed += 1;
    agg.cost += cost;
    agg.price += price;
    byCategory.set(key, agg);
  }

  // Under-priced against the policy: to earn `target` on this cost, the price
  // should be cost / (1 - target/100). Flagged rather than applied, because
  // repricing 204 SKUs is the business owner's call, not the cost sheet's.
  const underPriced = [];
  for (const p of list) {
    const pct = marginPercentOf(p);
    if (pct === null) continue;
    if (pct < target) {
      underPriced.push({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        cost: unitCost(p),
        margin: Math.round(pct),
        // CEIL, not round. Rounding to the nearest peso lands BELOW the target
        // whenever the exact figure is fractional (cost 850 at 30% is 1214.28,
        // which rounds to 1214 for a 29.98% margin), so the product stays on
        // the under-priced list forever and the one-click reprice reports
        // success while changing nothing. Rounding up guarantees the
        // suggestion clears the very threshold that put it on this list.
        suggested: Math.ceil(cost(p) / (1 - target / 100)),
      });
    }
  }
  underPriced.sort((a, b) => a.margin - b.margin);

  const categories = [...byCategory.values()]
    .map(c => ({
      category: c.category,
      costed: c.costed,
      margin: c.price > 0 ? ((c.price - c.cost) / c.price) * 100 : null,
    }))
    .sort((a, b) => b.costed - a.costed);

  return {
    target,
    coverage: coverageOf(list),
    blendedMargin: sumPrice > 0 ? ((sumPrice - sumCost) / sumPrice) * 100 : null,
    categoryCount: categories.length,
    categories,
    underPriced,
    lossMakers: list.filter(p => marginBucket(p) === 'loss').length,
  };
}

function cost(product) {
  return unitCost(product);
}

// ============================================================
// Acting on the under-priced table.
//
// buildCostInsights deliberately only SUGGESTS a price: repricing a catalog is
// the business owner's call. But "here is a number, now type it into the bulk
// price sheet yourself" throws away the analysis the panel just did, and the
// suggestion is a pure function of the row, so there is nothing to be careful
// about beyond confirming it.
//
// What this module returns is a PLAN, not a call: the same shape as the cost
// sheet's, so the caller can show it, confirm it, and send it through the one
// audited endpoint. buildRepricePlan is pure and is what the tests drive.

// Turn N under-priced rows into the exact payload /bulk-prices expects.
//
// Refuses, loudly, in three cases that would otherwise look like success:
//   - a suggested price that is not above the current one (rounding at the
//     target boundary can land on the current price)
//   - a suggested price that is not a positive number
//   - a duplicate name, which the endpoint would silently apply twice
//
// Returns { prices, skipped } where `skipped` explains every row left out, so
// the confirmation dialog can say "12 of 14" instead of quietly sending 12.
export function buildRepricePlan(underPriced) {
  const rows = Array.isArray(underPriced) ? underPriced : [];
  const prices = [];
  const skipped = [];
  const seen = new Set();

  for (const u of rows) {
    if (!u || !u.name) { skipped.push({ name: '(unnamed)', reason: 'no product name' }); continue; }
    const key = String(u.name).trim().toLowerCase();
    if (seen.has(key)) { skipped.push({ name: u.name, reason: 'listed twice' }); continue; }
    const suggested = Number(u.suggested);
    if (!Number.isFinite(suggested) || suggested <= 0) { skipped.push({ name: u.name, reason: 'no usable suggested price' }); continue; }
    const current = Number(u.price);
    // A suggestion at or below the current price is not a reprice. Applying it
    // would still write a row and still report "1 updated", which is the sort
    // of thing that makes a change log untrustworthy.
    if (Number.isFinite(current) && suggested <= current) { skipped.push({ name: u.name, reason: 'already at or above the target' }); continue; }
    seen.add(key);
    prices.push({ id: u.id, name: u.name, price: suggested });
  }

  return { prices, skipped, total: rows.length };
}

// The sentence the confirmation dialog shows. A bulk reprice rewrites the
// number every margin, quote and profit figure is derived from, so the user is
// told the shape of the change and the money it moves, not just "are you sure".
export function describeReprice(plan, targetMargin) {
  const prices = (plan && Array.isArray(plan.prices)) ? plan.prices : [];
  const skipped = (plan && Array.isArray(plan.skipped)) ? plan.skipped : [];
  if (prices.length === 0) return 'Nothing to reprice.';
  const uplift = prices.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  const parts = [
    `${prices.length} price${prices.length === 1 ? '' : 's'} will be raised to the ${targetMargin}% target`,
    `new list value ${Math.round(uplift)}`,
  ];
  if (skipped.length) parts.push(`${skipped.length} left out`);
  return parts.join(' · ') + '.';
}

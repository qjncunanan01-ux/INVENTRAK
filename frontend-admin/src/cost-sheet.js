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

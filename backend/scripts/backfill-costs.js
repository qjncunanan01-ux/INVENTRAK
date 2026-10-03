// Backfill product cost-of-goods from a supplier CSV.
//
// WHY
// Every product in the catalog shipped with `cost = NULL`, because INVENTRAK
// had no cost field at all until Costing Records introduced one. Until a
// catalog is costed, every Costing Record reports `cost_basis: 'none'` and the
// margin figures are honest nulls rather than answers. At 205 products nobody
// types costs one box at a time, so the practical options are the admin bulk
// cost sheet or this script.
//
// DRY RUN BY DEFAULT
// This writes to the live catalog, so it reports its full plan and changes
// nothing until you pass --apply. A dry run and an apply are computed from the
// same plan, so the numbers the dry run prints are the numbers the apply does.
//
//   npm run costs:backfill                        # dry run, reads data/product-costs.csv
//   npm run costs:backfill -- --file costs.csv   # dry run against another file
//   npm run costs:backfill -- --apply             # write
//
// TARGET
//   SUPABASE_URL + SUPABASE_KEY set -> the Supabase REST API, writing ONLY the
//     products that actually change (a PATCH per row), not a table flush.
//   otherwise                     -> the SQLite database db.js resolves,
//     honouring INVENTRAK_DB_PATH.
//
// The admin console is the better tool when the sheet is on screen; this is for
// the case where the costs arrive as a file from a supplier and should not be
// retyped.
//
// CSV FORMAT (header row optional)
//   Product Name,Cost
//   Product Name,Price,Cost
//   Product Name,Cost      where Cost is `-` / `clear` to mark "not costed"
//
// A BLANK cost cell means LEAVE THE PRODUCT ALONE, never clear it. That is the
// same rule the admin sheet uses (frontend-admin/src/cost-sheet.js) and it is
// the one that matters: defaulting a blank to "clear" would let a partial sheet
// silently wipe every cost it did not mention, and still report success.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fileFlagIndex = args.findIndex(a => a.startsWith('--file='));
const fileFlag = fileFlagIndex >= 0 ? args[fileFlagIndex].slice('--file='.length) : null;
const positional = args.filter(a => !a.startsWith('--'));
const csvPath = path.resolve(fileFlag || positional[0] || path.join(__dirname, '..', 'data', 'product-costs.csv'));

const CLEAR_TOKENS = new Set(['-', '--', 'clear', 'none', 'null', 'n/a', 'n/a']);
const HEADER_WORDS = /^(name|product\s*name|cost|costs|id|price|sku|product)$/i;
const CURRENCY_FRAGMENT = /^[₱$€£]\s*\d{1,3}$|^\d{1,3}[₱$€£]$/;

function log(...a) { console.log('[costs:backfill]', ...a); }

// --- CSV parsing (mirrors frontend-admin/src/cost-sheet.js) ----------------

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out.map(c => c.trim());
}

// -> number | 'clear' | 'skip' | 'junk'
function parseCostCell(cell) {
  const raw = String(cell === undefined || cell === null ? '' : cell).trim();
  if (raw === '') return 'skip';
  if (CLEAR_TOKENS.has(raw.toLowerCase())) return 'clear';
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  // Number('') is 0 — an unreduced cell is junk, not a free product.
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 'junk';
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 'junk';
  return n;
}

function parseSheet(text) {
  const rows = [];
  let isHeader = true;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.includes('\t') ? line.split('\t').map(c => c.trim()) : splitCsvLine(line);
    if (cols.length >= 3 && CURRENCY_FRAGMENT.test(cols[cols.length - 2])) {
      cols[cols.length - 2] += cols[cols.length - 1];
      cols.pop();
    }
    const firstNum = Number(cols[0]);
    const hasId = cols.length >= 3 && Number.isInteger(firstNum) && firstNum >= 1;
    const name = String(hasId ? cols[1] : cols[0] || '').trim().replace(/^["']|["']$/g, '');
    if (!name) continue;
    if (isHeader && HEADER_WORDS.test(name)) { isHeader = false; continue; }
    isHeader = false;
    rows.push({ id: hasId ? firstNum : undefined, name, cost: cols.length < 2 ? 'skip' : parseCostCell(cols[cols.length - 1]) });
  }
  return rows;
}

// --- Product shapes -------------------------------------------------------
// The catalog is id/idx/data JSONB in Supabase and a `Cost` column in SQLite,
// but the npm-free JSON row spells it 'Cost'. Read all three.

const unitCostOf = (p) => {
  const raw = p && p.cost !== undefined ? p.cost : (p && p.Cost !== undefined ? p.Cost : null);
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// --- Targets --------------------------------------------------------------

async function supabaseTarget() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const rest = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const res = await fetch(`${rest}/products?select=id,idx,data&order=idx.asc`, { headers });
  if (!res.ok) throw new Error(`reading products: ${res.status} ${await res.text()}`);
  const body = await res.json();
  // One PATCH per changed row. Deliberately NOT a table flush: this script must
  // not be able to clobber a product someone edited while it was running.
  const write = async (id, data) => {
    const r = await fetch(`${rest}/products?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify({ data }) });
    if (!r.ok) throw new Error(`writing product ${id}: ${r.status} ${await r.text()}`);
  };
  return {
    kind: 'supabase',
    label: `Supabase (${url})`,
    rows: body.map(r => ({ id: r.id, name: r.data && (r.data['Product Name'] || r.data.name), price: r.data && r.data.Price, cost: unitCostOf(r.data), data: r.data })),
    write,
  };
}

function sqliteTarget() {
  let db;
  try {
    ({ db } = require('../src/db'));
  } catch (err) {
    throw new Error(`SQLite target unavailable (${err.message}). Set SUPABASE_URL and SUPABASE_KEY to target Supabase instead.`);
  }
  return {
    kind: 'sqlite',
    label: `SQLite (${process.env.INVENTRAK_DB_PATH || 'default'})`,
    rows: db.prepare('SELECT id, name, price, cost FROM products').all(),
    write(id, cost) {
      db.prepare("UPDATE products SET cost = ?, updated_at = datetime('now') WHERE id = ?").run(cost, id);
    },
  };
}

// --- Plan -----------------------------------------------------------------

function buildPlan(rows, products) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  const byName = new Map(products.map(p => [String(p.name || '').trim().toLowerCase(), p]));
  const plan = [];
  const skipped = [];
  const duplicates = [];
  const junk = [];
  const lossMakers = [];
  const seen = new Set();
  let set = 0, clear = 0, unchanged = 0;

  for (const row of rows) {
    if (row.cost === 'junk') { junk.push(row.name); continue; }
    const product = row.id ? byId.get(String(row.id)) : byName.get(String(row.name || '').trim().toLowerCase());
    if (!product) { skipped.push(row.name); continue; }
    // One decision per product: the first row in the file wins, so a duplicated
    // name in the sheet cannot make the outcome depend on write ordering.
    // Reported separately from "unmatched" — a duplicate was found, and saying
    // otherwise sends the user looking for a catalog entry that is right there.
    if (seen.has(String(product.id))) { duplicates.push(row.name); continue; }
    seen.add(String(product.id));

    if (row.cost === 'skip') continue;
    const current = unitCostOf(product);
    if (row.cost === 'clear') {
      if (current === null) { unchanged += 1; continue; }
      clear += 1;
      plan.push({ id: product.id, name: product.name, from: current, to: null });
    } else {
      if (current === row.cost) { unchanged += 1; continue; }
      set += 1;
      plan.push({ id: product.id, name: product.name, from: current, to: row.cost });
      const price = Number(product.price);
      // Costing.js would faithfully report a 0% or negative margin from this,
      // which looks like a bug in the math rather than a transposed column.
      if (Number.isFinite(price) && price > 0 && row.cost >= price) {
        lossMakers.push({ name: product.name, cost: row.cost, price });
      }
    }
  }
  return { plan, skipped, duplicates, junk, lossMakers, set, clear, unchanged };
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    log(`no cost sheet at ${csvPath}`);
    log('create one — "Product Name,Cost" per line, header optional — or pass --file <path>.');
    process.exitCode = 1;
    return;
  }

  const target = (await supabaseTarget()) || sqliteTarget();
  const rows = parseSheet(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length === 0) { log(`${path.basename(csvPath)} has no parseable rows.`); process.exitCode = 1; return; }

  log(`target: ${target.label}`);
  log(`sheet:  ${csvPath} (${rows.length} row(s))`);
  const { plan, skipped, duplicates, junk, lossMakers, set, clear, unchanged } = buildPlan(rows, target.rows);

  const costed = target.rows.filter(p => unitCostOf(p) !== null).length;
  log(`catalog: ${target.rows.length} product(s), ${costed} already costed`);
  log('');
  log(`plan: ${set} to set, ${clear} to clear, ${unchanged} already correct, ${skipped.length} unmatched, ${duplicates.length} duplicate, ${junk.length} unreadable`);
  for (const p of plan.slice(0, 25)) {
    log(`  ${p.name}: ${p.from === null ? 'not costed' : p.from} -> ${p.to === null ? 'not costed' : p.to}`);
  }
  if (plan.length > 25) log(`  …and ${plan.length - 25} more`);
  if (skipped.length) log(`  unmatched: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ` …+${skipped.length - 10}` : ''}`);
  if (duplicates.length) log(`  duplicate rows (first one won): ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? ` …+${duplicates.length - 10}` : ''}`);
  if (junk.length) log(`  unreadable cost cells: ${junk.slice(0, 10).join(', ')}`);
  if (lossMakers.length) {
    log('');
    log(`WARNING: ${lossMakers.length} cost(s) are at or above the selling price:`);
    for (const l of lossMakers.slice(0, 10)) log(`  ${l.name}: cost ${l.cost} vs price ${l.price}`);
  }

  if (!apply) {
    log('');
    log('DRY RUN — nothing was written. Re-run with --apply to make these changes.');
    return;
  }
  if (plan.length === 0) { log(''); log('nothing to do.'); return; }

  log('');
  log(`applying ${plan.length} change(s)…`);
  for (const p of plan) {
    if (target.kind === 'supabase') {
      // Patch the row's JSONB in place, leaving every other field untouched.
      await target.write(p.id, { ...p.data, Cost: p.to });
    } else {
      target.write(p.id, p.to);
    }
  }
  const after = ((await supabaseTarget()) || sqliteTarget()).rows;
  const verified = after.filter(p => unitCostOf(p) !== null).length;
  log(`done. ${verified}/${after.length} products are now costed.`);
}

main().catch(err => {
  console.error('[costs:backfill] failed:', err.message);
  process.exitCode = 1;
});

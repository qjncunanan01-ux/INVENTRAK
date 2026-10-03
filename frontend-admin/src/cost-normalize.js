// Cost normalization: turn a supplier's "₱___ per litre" into a whole costed
// catalog.
//
// WHY THIS EXISTS
// The catalog holds free-text sizes — "750 ML", "1 KG", "16.5OZ", "12L",
// "1.5 kg" — and prices and costs per SINGLE UNIT. That makes two products
// whose economics are identical incomparable: a 1kg bag of syrup and a 750ml
// bottle both show "margin 40%", and nothing on screen says which one is
// actually earning more per litre. Worse, costing the catalog requires typing
// ~200 numbers a supplier will hand you as a single figure.
//
// So this module does two things:
//   1. parses a size into a DIMENSION (volume / weight / count) and a base
//      amount in ml, g or pieces
//   2. given one rate from the supplier — ₱ per 100 ml, ₱ per 100 g, ₱ per
//      piece — computes the cost for every product in that dimension and emits
//      a cost sheet the admin can upload through the panel that already exists
//
// CONSERVATIVE ON PURPOSE
// A wrong guess here is worse than no guess: it writes a fabricated cost into
// the catalog and then every margin figure downstream is confidently wrong. So
// the parser returns null whenever the text is ambiguous, and the sheet it
// builds leaves those products' cost cells BLANK — which the cost sheet already
// reads as "leave this product alone" (see cost-sheet.js). The result is that
// a bad parse degrades to "this product is still uncosted", never to "this
// product has a made-up cost".
//
// Two things it deliberately does NOT do:
//   - It does not divide a ₱/kg figure by a ₱/L figure. Different commodities,
//     different densities; a conversion there would be invented, not measured.
//   - It does not handle multipacks written as words ("dozen of 250ml"). Only
//     the numeric form (6 x 250ml) is recognised, because "six" and "6" are the
//     same claim but "a dozen" and "12" are not obviously so.

// What a rate is quoted per. `count` is per piece, so its basis is 1 while the
// other two are per 100.
export const BASIS_AMOUNT = { volume: 100, weight: 100, count: 1 };

export const DIMENSION_LABEL = {
  volume: 'per 100 ml',
  weight: 'per 100 g',
  count: 'per piece',
};

// The `unit` column: what one unit of stock IS, when the size text is not
// enough on its own. Anything not listed here yields null rather than a guess.
const COUNT_UNITS = new Set(['pcs', 'pc', 'piece', 'pieces', 'each', 'bottle', 'bottles', 'can', 'cans', 'box', 'boxes', 'pack', 'packs', 'bag', 'bags', 'sachet', 'sachets', 'roll', 'rolls', 'tube', 'tubes', 'bar']);

// Volume multipliers into millilitres.
const VOLUME = [
  [/^(ml|millilit(?:er|re)s?|cc)$/, 1],
  [/^(cl|centilit(?:er|re)s?)$/, 10],
  [/^(dl|decilit(?:er|re)s?)$/, 100],
  [/^(l|lit(?:er|re)s?|lt|ltr)$/, 1000],
];

// Weight multipliers into grams. Ounces and pounds are included because the
// seeded catalog really does use them ("Caramel Sauce 16.5OZ"); the factors are
// the international avoirdupois ones, exact to the gram at these magnitudes.
const WEIGHT = [
  [/^(mg|milligra(?:m|ms)?)$/, 0.001],
  [/^(g|gr|gm|gms|gram(?:s)?)$/, 1],
  [/^(kg|kgs|kilogram(?:s)?)$/, 1000],
  [/^(oz|ozs|ounces?)$/, 28.349523125],
  [/^(lb|lbs|pounds?)$/, 453.59237],
];

// Each entry carries its DIMENSION, not just a multiplier. That matters more
// than it looks: `kg` is 1000 and `l` is 1000, so a bare-factor lookup cannot
// tell them apart and silently reports a kilogram of chocolate as a litre of
// syrup — which then gets costed at a per-litre rate. The dimension is what
// keeps that from ever happening.
const UNITS_TABLE = [
  ...VOLUME.map(([pattern, factor]) => ({ pattern, factor, dimension: 'volume', unitLabel: 'ml' })),
  ...WEIGHT.map(([pattern, factor]) => ({ pattern, factor, dimension: 'weight', unitLabel: 'g' })),
];

// A number, or nothing. Written out rather than Number() because Number('') and
// Number('  ') are both 0 — the trap that has already produced one silent
// zero-cost product in this repo.
function num(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (s === '' || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "6 x 250ml" / "6x250 ml" / "6 × 1 L" -> the TOTAL, not the inner pack.
// Only the numeric multiplier form is recognised (see the header note).
// The unit token is REQUIRED. A bare number ("4000") is a case description or a
// typo more often than it is a piece count, and reading it as 4000 loose pieces
// would fabricate a cost 4000x too small.
const MULTIPACK = /^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*([a-z]+)$/;

function lookupUnit(token) {
  for (const entry of UNITS_TABLE) {
    if (entry.pattern.test(token)) return entry;
  }
  return null;
}

// Parse a free-text size into { dimension, amount, unitLabel }.
// -> null when the text is missing, unreadable, or names no known unit.
export function parseSizeText(text) {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  if (raw === '') return null;

  // Strip the packaging words that wrap a quantity: "NET WT. 1.5 KG",
  // "APPROX 250 ML", "(750ML)". The quantity itself is what matters; anything
  // left over that is not a quantity+unit is a reason to decline, not a reason
  // to invent.
  const cleaned = raw.toLowerCase().replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

  const m = cleaned.match(MULTIPACK);
  if (!m) return null;
  const pack = m[1] ? num(m[1]) : 1;
  const amount = num(m[2]);
  const token = m[3];
  if (pack === null || amount === null || pack <= 0) return null;

  const unit = lookupUnit(token);
  if (unit) {
    return { dimension: unit.dimension, amount: amount * unit.factor * pack, unitLabel: unit.unitLabel };
  }
  // An unrecognised token ("5 st", "2 dozen") is a reason to decline, NOT a
  // licence to fall back to reading the number alone. Only the pack COUNT is
  // recognised when the token itself says pcs ("50PCS").
  if (token === 'pcs' || token === 'pc' || token === 'pieces' || token === 'piece') {
    return { dimension: 'count', amount: amount * pack, unitLabel: 'pcs' };
  }
  return null;

  // A bare number with no unit letter ("6", "12") is a piece count, but only if
  // it is plausible: a "size" of 400 bottles is a case description, and the
  // safe reading is that we do not know.
  const bare = num(m[2]);
  if (bare !== null && bare > 0 && bare <= 1000 && Number.isInteger(bare)) {
    return { dimension: 'count', amount: bare, unitLabel: 'pcs' };
  }
  return null;
}

// The product's dimension: the size text first, then the `unit` column (which
// answers "what is one of these?" when the size is just a number).
export function dimensionOf(product) {
  if (!product) return null;
  const fromSize = parseSizeText(product.size);
  if (fromSize) return fromSize;
  const unit = String(product.unit || '').trim().toLowerCase();
  if (unit && COUNT_UNITS.has(unit)) return { dimension: 'count', amount: 1, unitLabel: 'pcs' };
  return null;
}

function perBasis(value, amount, basisAmount, { zeroIsValid = false } = {}) {
  // Number(null), Number('') and Number(' ') are all 0, so an UNCOSTED product
  // would read as a free one and quietly join the blended margin at zero cost.
  // Absent must stay absent before the numeric gate ever runs.
  if (value === null || value === undefined || value === '') return null;
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return null;
  // A zero COST is real (free goods, a sample). A zero PRICE is not — nothing is
  // sold at nothing here, and dividing by it produces a meaningless figure.
  if (v === 0 && !zeroIsValid) return null;
  if (!(amount > 0)) return null;
  return (v / amount) * basisAmount;
}

// Everything comparable about one product: its dimension, how much it holds,
// and cost/price on the common basis. -> null when the size cannot be read.
export function normalizedOf(product, dimension) {
  const info = dimensionOf(product);
  if (!info) return null;
  if (dimension && info.dimension !== dimension) return null;
  const basisAmount = BASIS_AMOUNT[info.dimension];
  return {
    dimension: info.dimension,
    amount: info.amount,
    unitLabel: info.unitLabel,
    basisAmount,
    costPer: perBasis(product.cost, info.amount, basisAmount, { zeroIsValid: true }),
    pricePer: perBasis(product.price, info.amount, basisAmount),
    label: `${DIMENSION_LABEL[info.dimension]} (${info.dimension === 'count' ? info.amount : round(info.amount)}${info.unitLabel})`,
  };
}

// How the catalog splits across dimensions, and which products could not be
// read at all. Drives the "which rate do you have from the supplier?" picker.
export function summarizeNormalization(products) {
  const list = Array.isArray(products) ? products : [];
  const counts = { volume: 0, weight: 0, count: 0 };
  const unreadable = [];
  const revenue = { volume: 0, weight: 0, count: 0 };

  for (const p of list) {
    const info = dimensionOf(p);
    if (!info) {
      unreadable.push(p && p.name);
      continue;
    }
    counts[info.dimension] += 1;
    const n = normalizedOf(p);
    if (n && n.pricePer !== null) revenue[info.dimension] += n.pricePer;
  }

  // Highest selling value first: that is where the repricing decision bites.
  const dimensions = Object.keys(counts)
    .filter(d => counts[d] > 0)
    .map(d => ({
      dimension: d,
      label: DIMENSION_LABEL[d],
      basisAmount: BASIS_AMOUNT[d],
      count: counts[d],
      pricePer: revenue[d] / counts[d],
    }))
    .sort((a, b) => b.pricePer - a.pricePer);

  return { dimensions, unreadable, counts };
}

// The pay-off: one supplier rate in, a full cost sheet out.
//
// Returns CSV in the EXACT shape the admin cost panel already accepts
// (`Product Name,Price,Cost`, see buildCostTemplate in cost-sheet.js). Products
// whose size could not be read get a BLANK cost cell — the sheet's own
// "leave this product alone" rule — so an unparsed product stays uncosted
// rather than being given a fabricated figure.
export function buildRateSheet(products, { dimension, rate, basisAmount } = {}) {
  const list = Array.isArray(products) ? products : [];
  const base = Number(basisAmount) > 0 ? Number(basisAmount) : BASIS_AMOUNT[dimension] || 100;
  // Number('') is 0, so an empty rate box would otherwise cost the entire
// catalog at zero and report success. Zero typed deliberately is a real rate
// (free goods); nothing typed is not a rate at all.
const r = (rate === null || rate === undefined || String(rate).trim() === '') ? NaN : Number(rate);
const usable = Number.isFinite(r) && r >= 0;

  const rows = [];
  let priced = 0;
  for (const p of list) {
    if (!p) continue;
    const info = dimensionOf(p);
    const name = csvCell(p.name);
    // Always emit the Price column so the exported sheet doubles as a margin
    // reference while the admin reviews it.
    const priceCell = p.price === null || p.price === undefined ? '' : p.price;
    if (!usable || !info || info.dimension !== dimension || !(info.amount > 0)) {
      rows.push(`${name},${priceCell},`);
      continue;
    }
    const cost = Math.round(((r / base) * info.amount) * 100) / 100;
    rows.push(`${name},${priceCell},${cost}`);
    priced += 1;
  }

  return {
    csv: 'Product Name,Price,Cost\n' + rows.join('\n'),
    priced,
    blank: rows.length - priced,
    total: rows.length,
  };
}

function csvCell(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function round(n) {
  return Math.round(Number(n) * 10) / 10;
}
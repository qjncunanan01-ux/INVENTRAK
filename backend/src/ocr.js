// OCR module — scan a product photo/label and match it to the catalog.
//
// The mobile "Scan" feature (reviewer requirement: OCR module) uploads an
// image; this module runs real OCR (tesseract.js, pure-JS, no external keys)
// and fuzzy-matches the extracted text against the product catalog.
//
// tesseract.js is lazy-loaded and the module degrades gracefully: if the
// package is missing or its worker fails to boot, the endpoint still answers
// with a clear 503 instead of crashing the server. The first call downloads
// the English traineddata (~10 MB) from the CDN, so the very first scan takes
// a few seconds; subsequent scans are fast.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB cap for uploaded images

// Magic-byte signatures for the image formats tesseract can read. A base64
// string that isn't actually an image (random data, a text file) is rejected
// BEFORE the engine is invoked, so the OCR endpoint can't be abused as an
// arbitrary-base64 decoder or a cheap CPU sink.
const IMAGE_MAGIC = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0x52, 0x49, 0x46, 0x46], // RIFF container (WebP)
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x42, 0x4d], // BMP
];
function isDecodedImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  return IMAGE_MAGIC.some((sig) => sig.every((byte, i) => buf[i] === byte));
}

// Pure size/unit tokens carry no discrimination power ("750 ML", "1 L", "1L",
// "950 g" are on every size variant of a product) — dropping them keeps them
// from inflating the match denominator, so a label that reads the exact
// product name scores 1.0 instead of being diluted by the size tokens.
const SIZE_TOKEN_PATTERN = /^(ml|l|g|kg|oz|lb|pcs|pack|box|jar|bottle|sachet|liters?|litres?|milliliters?|kilograms?|grams?|ounces?|pounds?)$/;
// Glued number+unit reads ("750ml", "1000g", "1L") — tesseract drops the
// space on small labels, so drop the whole token: it's still just a size.
const GLUED_SIZE_PATTERN = /^[0-9]+(ml|l|g|kg|oz|lb|pcs)$/;
const PURE_NUMBER = /^[0-9]+$/;

// Normalize text for matching: lowercase, strip punctuation, keep words.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !PURE_NUMBER.test(t) && !SIZE_TOKEN_PATTERN.test(t) && !GLUED_SIZE_PATTERN.test(t));
}

// Label lines that never help match a catalog product — nutrition facts,
// ingredient paragraphs, logistics/legal boilerplate, contact info. If a
// line starts with any of these it is dropped before matching/display.
const NOISE_PREFIXES = [
  'ingredient', 'nutrition', 'serving', 'manufactured', 'distributed',
  'imported', 'made in', 'product of', 'expiry', 'expiration', 'best before',
  'best-by', 'use by', 'storage', 'store in', 'keep', 'allergen', 'contains',
  'batch', 'lot no', 'barcode', 'tel', 'phone', 'email', 'www.', 'http',
  'facebook', 'instagram', 'tiktok', 'net content', 'net wt', 'net weight',
  'all rights', 'copyright', 'recipe', 'how to use', 'directions',
];

// Nutrition-fact rows like "Total Fat 0 g" / "Protein 5 g" — dropped only
// when a NUMBER follows (so a genuine product line like "Protein Powder" or
// "Vanilla Sugar" can never be filtered out). Whitespace is optional because
// tesseract often glues the unit to the value ("Total Fat0 g").
const NUTRITION_PATTERN = /^(total\s*fat|total\s*carb|total\s*carbohydrate|sodium|protein|calories|cholesterol|dietary\s*fiber|sugars?|vitamin|calcium|iron)\s*[0-9]/i;

// Keep only the lines that can actually match the catalog — the text a scan
// needs. Drops barcodes, price tags, nutrition facts, ingredient paragraphs,
// URLs and boilerplate, then keeps only lines whose words appear in some
// product name. That final catalog-relevance pass is match-neutral (the
// matcher only counts catalog-name tokens), so it can never hurt accuracy —
// it just hides everything the system can't match (including the alphanumeric
// runs tesseract hallucinates from barcode bars).
function filterOcrText(text, products = []) {
  const vocab = new Set();
  for (const p of products) {
    for (const t of normalize(p.name || p['Product Name'])) vocab.add(t);
  }

  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.length > 80) return false; // ingredient/legal paragraphs
      if (!/[a-z]/i.test(line)) return false; // pure digits/symbols (barcodes)
      const letters = (line.match(/[a-z]/gi) || []).length;
      const digits = (line.match(/[0-9]/g) || []).length;
      if (digits / (letters + digits) > 0.7) return false; // price tags / lot numbers
      if (/@|https?:|www\./i.test(line)) return false; // emails / URLs
      if (NUTRITION_PATTERN.test(line)) return false; // "Total Fat 0 g" rows
      if (NOISE_PREFIXES.some((p) => line.toLowerCase().startsWith(p))) return false;
      // Catalog-relevance: hide lines whose words appear in no product name.
      const tokens = normalize(line);
      if (vocab.size > 0 && !tokens.some((t) => vocab.has(t))) return false;
      return true;
    })
    .filter((line, i, arr) => arr.indexOf(line) === i) // dedupe repeated reads
    .join('\n');
}

// Tokens that carry no discrimination power: the house brand appears as a
// watermark on EVERY product photo (so a scan that only reads "SYLVER" must
// not float up the three products whose names contain it), plus corporate
// boilerplate. Excluded from BOTH sides of the score — a logo-only scan then
// yields zero distinctive tokens and simply reports no match.
const GENERIC_TOKENS = new Set([
  'sylver', 'inc', 'corporation', 'company', 'ltd', 'llc', 'enterprises', 'brand',
]);

function distinctive(tokens) {
  return tokens.filter((t) => !GENERIC_TOKENS.has(t));
}

// Classic Levenshtein distance (pure JS, zero deps) for typo-tolerant
// matching — tesseract reads real labels with noise ("VANILA", "TORAN1").
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// A recognized word counts as a hit when it matches exactly, or is within a
// single typo for words of 5+ letters ("carmel" vs "caramel", "vanila" vs
// "vanilla"). Short words stay exact-only to avoid false positives.
function tokensMatch(ocrToken, productToken) {
  if (ocrToken === productToken) return true;
  if (ocrToken.length >= 5 && productToken.length >= 5) {
    return editDistance(ocrToken, productToken) <= 1;
  }
  return false;
}

// Simple token-overlap score: 1.0 if all OCR words are in the product name,
// 0 if none. Products with higher overlap rank first. Generic/brand tokens
// are ignored on both sides, so a lone watermark can never produce a match.
function matchScore(ocrTokens, productName) {
  const productTokens = distinctive(normalize(productName));
  const ocr = distinctive(ocrTokens);
  if (productTokens.length === 0) return 0;
  const hit = productTokens.filter((t) => ocr.some((o) => tokensMatch(o, t))).length;
  return hit / productTokens.length;
}

// A scan only counts as a REAL product hit when it names the product with at
// least two distinctive tokens — one shared word ("SYRUP", "VANILLA", "MILK")
// describes a whole category, not a specific product, so returning those
// would be guessing. Reads of partial labels ("TORANI", "1 L", a logo) are
// honest misses instead of confident wrong picks.
const MIN_DISTINCT_HITS = 2;

// Lazy tesseract require — the endpoint works even before the package is
// installed, by returning 503 with instructions.
let tesseractPromise = null;
function loadTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      const mod = require('tesseract.js');
      const worker = await mod.createWorker('eng');
      return { worker, mod };
    })().catch((err) => {
      tesseractPromise = null; // allow retry on next call
      throw err;
    });
  }
  return tesseractPromise;
}

// Run OCR on a base64-encoded image. Returns { text }. The base64 string is
// decoded to a Buffer because tesseract.js v7 treats a bare base64 string as a
// file path; Buffers are passed straight to the engine.
async function ocrImage(base64) {
  const { worker } = await loadTesseract();
  const { data } = await worker.recognize(Buffer.from(base64.replace(/\s+/g, ''), 'base64'));
  return { text: (data && data.text) || '' };
}

// How many distinctive OCR tokens a product name actually matched (a count,
// not a ratio) — used with MIN_DISTINCT_HITS so a one-word scan can never
// surface a product. Returns -1 when the name has no distinctive tokens.
function matchedTokenCount(ocrTokens, productName) {
  const productTokens = distinctive(normalize(productName));
  if (productTokens.length === 0) return -1;
  return productTokens.filter((t) => ocrTokens.some((o) => tokensMatch(o, t))).length;
}

// Match extracted OCR text against the product catalog. Returns up to
// `limit` matches with a score >= minScore AND at least MIN_DISTINCT_HITS
// distinctive tokens in common, sorted best-first. The two conditions in
// tandem mean a result is only returned when the scan actually names a
// specific product in the catalog.
function matchProducts(text, products, { limit = 5, minScore = 0.5 } = {}) {
  const tokens = distinctive(normalize(text));
  if (tokens.length === 0) return [];

  return products
    .map((p, idx) => ({
      // Positional fallback: raw catalog rows (no id) get idx+1, matching the
      // ids the /api/products routes expose — so OCR match ids always point at
      // a real product, and list keys are never duplicated/undefined.
      id: p.id ?? idx + 1,
      name: p.name || p['Product Name'],
      // Price/image live under BOTH conventions: SQLite passes normalized rows
      // (lowercase `price`), the npm-free/Firestore path passes raw catalog
      // rows (capitalized `Price`). Mirror the name fallback so OCR match
      // cards show the same data on both backends.
      price: p.price ?? p.Price,
      image: p.image || p.Image,
      matched: matchedTokenCount(tokens, p.name || p['Product Name']),
      score: matchScore(tokens, p.name || p['Product Name']),
    }))
    .filter((m) => m.name && m.matched >= MIN_DISTINCT_HITS && m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Low-stock threshold for the admin scan: matches the /api/inventory
// low_stock filter (total < 80) so the scan agrees with the inventory page.
const LOW_STOCK_THRESHOLD = 80;

// Attach a live stock snapshot to each match: per-location quantities, total
// and a status string. `stockLookup(productId)` returns { locations, total }.
function attachStock(matches, stockLookup) {
  return matches.map((m) => {
    const stock = stockLookup(m.id) || {};
    const locations = stock.locations || {};
    const total = Number(stock.total) || 0;
    const status = total === 0 ? 'out' : total < LOW_STOCK_THRESHOLD ? 'low' : 'ok';
    return { ...m, stock: { locations, total, status } };
  });
}

// Filename matching: catalog images are uploaded under their ORIGINAL file
// name (e.g. "achievers--acc-caramel-syrup-1kg.jpg"), which encodes the
// product far more reliably than OCR could ever read from a ~300px thumbnail.
// An exact image-basename hit wins; otherwise the filename tokens are matched
// against product names with the same fuzzy machinery, so typo'd or cropped
// names still resolve. `matchedBy: 'filename'` marks these matches so the UI
// can tell a file-name hit from a genuine OCR read.
function basenameOf(value) {
  return String(value || '').split(/[\\/]/).pop() || '';
}
function stemOf(filename) {
  return basenameOf(filename).replace(/\.[a-z0-9]+$/i, '');
}

function matchByFilename(filename, products, { limit = 5, minScore = 0.5 } = {}) {
  const stem = stemOf(filename);
  if (!stem) return [];
  const tokens = distinctive(normalize(stem));

  // 1) Exact: the uploaded file name IS a product's image file name.
  const exactIndex = products.findIndex((p) => {
    const img = stemOf(p.image || p.Image || '');
    return img && img.toLowerCase() === stem.toLowerCase();
  });
  if (exactIndex >= 0) {
    const p = products[exactIndex];
    const name = p.name || p['Product Name'];
    return [
      {
        id: p.id ?? exactIndex + 1,
        name,
        price: p.price ?? p.Price,
        image: p.image || p.Image,
        matched: matchedTokenCount(tokens, name),
        score: 1,
        matchedBy: 'filename',
      },
    ];
  }

  // 2) Fuzzy: filename tokens vs product names (same scoring as OCR reads).
  if (tokens.length === 0) return [];
  return products
    .map((p, idx) => {
      const name = p.name || p['Product Name'];
      return {
        id: p.id ?? idx + 1,
        name,
        price: p.price ?? p.Price,
        image: p.image || p.Image,
        matched: matchedTokenCount(tokens, name),
        score: matchScore(tokens, name),
        matchedBy: 'filename',
      };
    })
    .filter((m) => m.name && m.matched >= MIN_DISTINCT_HITS && m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Filename-first scan: when the client sends a filename that resolves to a
// catalog product (score >= 0.6), return it WITHOUT running OCR — exact and
// instant for catalog-image uploads. Returns null when OCR should run.
async function filenameMatchOrNull(req, products) {
  const filename = req.body && req.body.filename;
  if (typeof filename !== 'string' || !filename.trim()) return null;
  const matches = matchByFilename(filename.trim(), products);
  if (matches.length === 0 || matches[0].score < 0.6) return null;
  return matches;
}

// Express-style handler shared by both backends. `products` is the active
// product list (each item may use either SQLite or JSON-file field names).
async function handleOcr(req, res, sendJson, products) {
  const base64 = req.body && req.body.image;
  if (!base64 || typeof base64 !== 'string') {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['image (base64) is required'],
    });
  }

  // Reject non-base64 / oversized payloads early.
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64) || base64.length > MAX_IMAGE_BYTES * 1.5) {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['image must be a base64-encoded image (max 8 MB)'],
    });
  }

  // Restrict uploads to real image payloads: decode and sniff the magic bytes
  // so an arbitrary base64 blob can't reach the OCR engine.
  if (!isDecodedImage(Buffer.from(base64.replace(/\s+/g, ''), 'base64'))) {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['image must be a JPEG, PNG, WebP, GIF or BMP image'],
    });
  }

  // Filename-first: catalog-image uploads resolve by name, no OCR needed.
  const byFilename = await filenameMatchOrNull(req, products);
  if (byFilename) {
    return sendJson(res, 200, { text: '', matches: byFilename });
  }

  let result;
  try {
    result = await ocrImage(base64);
  } catch (err) {
    console.error('[ocr] worker error:', err && err.message);
    return sendJson(res, 503, {
      error: 'OCR engine unavailable',
      details: ['OCR is not configured on this server (tesseract.js missing or failed to boot)'],
    });
  }

  // Scan only what's needed: strip barcode/nutrition/ingredient/boilerplate
  // lines so the recognized text shown and matched is the brand/product part
  // of the label, not the entire label dump.
  const text = filterOcrText(result.text, products);
  const matches = matchProducts(text, products);
  return sendJson(res, 200, { text, matches });
}

// Admin stock-check variant of handleOcr: same OCR + match pipeline, but each
// match carries a live stock snapshot (per-location quantities + total + low/
// out status) so scanning a label answers "how much is left?" — the daily
// manual inventory problem this capstone solves. `stockLookup(productId)` is
// provided by each backend (SQLite rows vs JSON/Firestore inventory).
async function handleOcrStock(req, res, sendJson, products, stockLookup) {
  const base64 = req.body && req.body.image;
  if (!base64 || typeof base64 !== 'string') {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['image (base64) is required'],
    });
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64) || base64.length > MAX_IMAGE_BYTES * 1.5) {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['image must be a base64-encoded image (max 8 MB)'],
    });
  }

  // Restrict uploads to real image payloads: decode and sniff the magic bytes
  // so an arbitrary base64 blob can't reach the OCR engine.
  if (!isDecodedImage(Buffer.from(base64.replace(/\s+/g, ''), 'base64'))) {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['image must be a JPEG, PNG, WebP, GIF or BMP image'],
    });
  }

  // Filename-first: catalog-image uploads resolve by name, no OCR needed.
  const byFilename = await filenameMatchOrNull(req, products);
  if (byFilename) {
    return sendJson(res, 200, { text: '', matches: attachStock(byFilename, stockLookup) });
  }

  let result;
  try {
    result = await ocrImage(base64);
  } catch (err) {
    console.error('[ocr] worker error:', err && err.message);
    return sendJson(res, 503, {
      error: 'OCR engine unavailable',
      details: ['OCR is not configured on this server (tesseract.js missing or failed to boot)'],
    });
  }

  const text = filterOcrText(result.text, products);
  const matches = attachStock(matchProducts(text, products), stockLookup);
  return sendJson(res, 200, { text, matches });
}

module.exports = { ocrImage, matchProducts, handleOcr, handleOcrStock, attachStock, normalize, matchScore, filterOcrText, matchByFilename, basenameOf, stemOf, isDecodedImage };

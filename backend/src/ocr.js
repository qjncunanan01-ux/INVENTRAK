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

// Normalize text for matching: lowercase, strip punctuation, keep words.
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
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

// Simple token-overlap score: 1.0 if all OCR words are in the product name,
// 0 if none. Products with higher overlap rank first.
function matchScore(ocrTokens, productName) {
  const productTokens = normalize(productName);
  if (productTokens.length === 0) return 0;
  const hit = productTokens.filter((t) => ocrTokens.includes(t)).length;
  return hit / productTokens.length;
}

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

// Match extracted OCR text against the product catalog. Returns up to
// `limit` matches with a score >= minScore, sorted best-first.
function matchProducts(text, products, { limit = 5, minScore = 0.25 } = {}) {
  const tokens = normalize(text);
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
      score: matchScore(tokens, p.name || p['Product Name']),
    }))
    .filter((m) => m.name && m.score >= minScore)
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

module.exports = { ocrImage, matchProducts, handleOcr, handleOcrStock, attachStock, normalize, matchScore, filterOcrText };

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
    .map((p) => ({
      id: p.id,
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

  const matches = matchProducts(result.text, products);
  return sendJson(res, 200, { text: result.text, matches });
}

module.exports = { ocrImage, matchProducts, handleOcr, normalize, matchScore };

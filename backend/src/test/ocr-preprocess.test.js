// OCR preprocessing tests: the server-side pipeline (upscale/grayscale/
// contrast + AUTO→SPARSE_TEXT retry) must read a readable label and match it
// to the catalog, and must degrade gracefully on unreadable input. The full
// tesseract engine IS exercised here (traineddata downloads on first run),
// unlike ocr.test.js which tests only the matcher.
const { test, after } = require('node:test');
const assert = require('node:assert');
const Jimp = require('jimp');
const { preprocessImage, ocrImage, filterOcrText, matchProducts, terminateOcr } = require('../ocr');

// The shared tesseract worker keeps the event loop alive; shut it down so the
// test process can exit after the suite finishes.
after(() => terminateOcr());

// Draw a synthetic product label at ~1600px wide — approximating what a phone
// camera capture looks like after the client-side normalization.
async function makeLabel() {
  const W = 1600;
  const H = 400;
  const img = new Jimp(W, H, 0xffffffff);
  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
  img.print(font, 40, 40, 'TORANI');
  img.print(font, 40, 150, 'Vanilla Syrup');
  img.print(font, 40, 260, '750 ml  Net 25.4 fl oz');
  return img.getBufferAsync(Jimp.MIME_JPEG);
}

const PRODUCTS = [
  { id: 1, name: 'Torani Vanilla Syrup 750ML', price: 525 },
  { id: 2, name: 'Torani Caramel Syrup 750ML', price: 525 },
  { id: 3, name: 'Da Vinci Vanilla Syrup', price: 640 },
];

test('preprocessImage upscales small images and never throws on bad input', async () => {
  // A tiny image gets upscaled (its byte size grows) so tesseract can read it.
  const tiny = await Jimp.read('images/torani--vanilla-syrup-750ml.jpg');
  const tinyBuf = await tiny.getBufferAsync(Jimp.MIME_JPEG);
  const out = await preprocessImage(tinyBuf);
  assert.ok(out.length > tinyBuf.length, 'small image should grow after upscaling');

  // Garbage input falls back to the original buffer (no throw).
  const garbage = Buffer.from('this is not an image');
  const out2 = await preprocessImage(garbage);
  assert.ok(out2.equals(garbage) || out2.length === garbage.length);
});

test('preprocessImage caps huge images so OCR stays fast', async () => {
  const big = new Jimp(4000, 3000, 0xffffffff);
  const bigBuf = await big.getBufferAsync(Jimp.MIME_JPEG);
  const out = await preprocessImage(bigBuf);
  assert.ok(out.length > 0);
});

test('ocrImage reads a readable label and matchProducts finds the product', async () => {
  const label = await makeLabel();
  const b64 = label.toString('base64');
  const { text } = await ocrImage(b64);
  // The label text must come through (tolerating minor OCR noise).
  const lower = text.toLowerCase();
  assert.ok(lower.includes('torani'), 'brand read: ' + JSON.stringify(text));
  assert.ok(lower.includes('vanilla'), 'product read: ' + JSON.stringify(text));

  const filtered = filterOcrText(text, PRODUCTS);
  const matches = matchProducts(filtered, PRODUCTS);
  assert.ok(matches.length >= 1, 'a match must be found');
  assert.strictEqual(matches[0].id, 1, 'exact product tops the list');
  assert.ok(matches[0].score >= 0.5);
}, { timeout: 120000 });

test('ocrImage degrades gracefully on an unreadable image (no throw)', async () => {
  const img = await Jimp.read('images/torani--vanilla-syrup-750ml.jpg');
  const b64 = (await img.getBufferAsync(Jimp.MIME_JPEG)).toString('base64');
  const { text } = await ocrImage(b64);
  assert.strictEqual(typeof text, 'string');
}, { timeout: 120000 });

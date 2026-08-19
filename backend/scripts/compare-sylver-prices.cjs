#!/usr/bin/env node
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

// Fetch feed via curl (simpler)
const xml = execSync('curl -s https://sylverrestaurantandcafesupplier.kyte.site/feed/facebook', { timeout: 30000 }).toString();

// Parse feed
const feedProducts = [];
const re = /<item>([\s\S]*?)<\/item>/g;
let m;
while ((m = re.exec(xml)) !== null) {
  const b = m[1];
  const g = (tag) => { const x = b.match(new RegExp(`<g:${tag}>([^<]*)<\\/g:${tag}>`)); return x ? x[1].trim() : null; };
  feedProducts.push({
    title: g('title'),
    brand: g('brand'),
    price: parseFloat(g('price')) || 0,
    salePrice: g('sale_price') ? parseFloat(g('sale_price')) : null,
    inventory: parseInt(g('inventory')) || 0,
  });
}

// Load local
const localProducts = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// Build maps using normalized names
const feedByNorm = new Map();
for (const f of feedProducts) feedByNorm.set(norm(f.title), f);

const localByNorm = new Map();
for (const p of localProducts) localByNorm.set(norm(p['Product Name']), p);

// Find mismatches
const priceMismatches = [];
const feedOnly = [];
const localOnly = [];

// Check local vs feed
for (const local of localProducts) {
  const n = norm(local['Product Name']);
  let feedMatch = feedByNorm.get(n);
  // Fuzzy: try partial match
  if (!feedMatch) {
    for (const [fn, fp] of feedByNorm) {
      if (fn.includes(n) || n.includes(fn)) { feedMatch = fp; break; }
    }
  }
  if (!feedMatch) {
    localOnly.push(local);
    continue;
  }
  const feedPrice = feedMatch.salePrice || feedMatch.price;
  if (Math.abs(feedPrice - local.Price) > 0.01) {
    priceMismatches.push({
      name: local['Product Name'],
      localPrice: local.Price,
      feedPrice,
      feedTitle: feedMatch.title,
    });
  }
}

// Check feed vs local
for (const fp of feedProducts) {
  const n = norm(fp.title);
  let localMatch = localByNorm.get(n);
  if (!localMatch) {
    for (const [ln, lp] of localByNorm) {
      if (ln.includes(n) || n.includes(ln)) { localMatch = lp; break; }
    }
  }
  if (!localMatch) feedOnly.push(fp);
}

// Report
console.log(`Feed: ${feedProducts.length} products | Local: ${localProducts.length} products\n`);

if (priceMismatches.length) {
  console.log(`=== PRICE MISMATCHES (${priceMismatches.length}) ===`);
  for (const m of priceMismatches) {
    console.log(`  ${m.name}: local ₱${m.localPrice} → website ₱${m.feedPrice} (${m.feedTitle})`);
  }
} else {
  console.log('✅ All prices match!');
}

if (feedOnly.length) {
  console.log(`\n=== ON WEBSITE BUT NOT LOCALLY (${feedOnly.length}) ===`);
  for (const f of feedOnly) console.log(`  ${f.title} ₱${f.salePrice || f.price} [${f.brand}]`);
}

if (localOnly.length) {
  console.log(`\n=== LOCALLY BUT NOT ON WEBSITE (${localOnly.length}) ===`);
  for (const l of localOnly) console.log(`  ${l['Product Name']} ₱${l.Price} [${l.Category}]`);
}

console.log(`\nMatched: ${localProducts.length - localOnly.length}/${localProducts.length}`);

#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');
const xml = execSync('curl -s https://sylverrestaurantandcafesupplier.kyte.site/feed/facebook', { timeout: 30000 }).toString();

// Parse feed
const feed = [];
const re = /<item>([\s\S]*?)<\/item>/g;
let m;
while ((m = re.exec(xml)) !== null) {
  const b = m[1];
  const g = (tag) => { const x = b.match(new RegExp(`<g:${tag}>([^<]*)<\\/g:${tag}>`)); return x ? x[1].trim() : null; };
  feed.push({
    title: g('title'),
    brand: g('brand'),
    price: parseFloat(g('price')) || 0,
    salePrice: g('sale_price') ? parseFloat(g('sale_price')) : null,
    inventory: parseInt(g('inventory')) || 0,
  });
}

const local = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));

// Build a more intelligent matching: compare by brand+size or key words
function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Try to match feed item to local product by multiple strategies
function matchProduct(feedItem, localProducts) {
  const feedNorm = norm(feedItem.title);
  
  // Strategy 1: exact normalized name match
  for (const lp of localProducts) {
    if (norm(lp['Product Name']) === feedNorm) return lp;
  }
  
  // Strategy 2: feed title contains local name or vice versa (at least 15 chars)
  for (const lp of localProducts) {
    const localNorm = norm(lp['Product Name']);
    if (localNorm.length >= 15 && feedNorm.includes(localNorm)) return lp;
    if (feedNorm.length >= 15 && localNorm.includes(feedNorm)) return lp;
  }
  
  // Strategy 3: match by brand + size keywords
  const feedBrand = norm(feedItem.brand);
  for (const lp of localProducts) {
    const localCat = norm(lp.Category);
    const localName = norm(lp['Product Name']);
    // Same category/brand AND similar product type
    if ((localCat === feedBrand || feedBrand.includes(localCat) || localCat.includes(feedBrand)) && 
        localName.length > 5 && feedNorm.includes(localName.substring(0, Math.min(15, localName.length)))) {
      return lp;
    }
  }
  
  return null;
}

// Match feed products to local
const matched = [];
const unmatchedFeed = [];
for (const fp of feed) {
  const match = matchProduct(fp, local);
  if (match) {
    matched.push({ feed: fp, local: match });
  } else {
    unmatchedFeed.push(fp);
  }
}

// Find unmatched local
const matchedLocalIds = new Set(matched.map(m => m.local['Product Name']));
const unmatchedLocal = local.filter(p => !matchedLocalIds.has(p['Product Name']));

// Price mismatches (only for correctly matched products)
const priceMismatches = [];
for (const { feed: fp, local: lp } of matched) {
  const feedPrice = fp.salePrice || fp.price;
  if (Math.abs(feedPrice - lp.Price) > 0.01) {
    priceMismatches.push({ feed: fp, local: lp, feedPrice, localPrice: lp.Price });
  }
}

// Report
console.log(`Feed: ${feed.length} | Local: ${local.length} | Matched: ${matched.length}\n`);

console.log(`=== PRICE MISMATCHES (${priceMismatches.length}) ===`);
for (const m of priceMismatches) {
  const arrow = m.feedPrice < m.localPrice ? '↓' : '↑';
  console.log(`  ${m.local['Product Name']}: ₱${m.localPrice} → ₱${m.feedPrice} ${arrow} (${m.feed.title})`);
}

console.log(`\n=== ON WEBSITE BUT NOT LOCALLY (${unmatchedFeed.length}) ===`);
for (const f of unmatchedFeed) console.log(`  ${f.title} ₱${f.salePrice || f.price} [${f.brand}]`);

console.log(`\n=== LOCALLY BUT NOT ON WEBSITE (${unmatchedLocal.length}) ===`);
for (const l of unmatchedLocal) console.log(`  ${l['Product Name']} ₱${l.Price} [${l.Category}]`);

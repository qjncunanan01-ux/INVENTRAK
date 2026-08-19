#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DRY_RUN = process.argv.includes('--dry-run');
const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

const xml = execSync('curl -s https://sylverrestaurantandcafesupplier.kyte.site/feed/facebook', { timeout: 30000 }).toString();
const feed = [];
const re = /<item>([\s\S]*?)<\/item>/g;
let m;
while ((m = re.exec(xml)) !== null) {
  const b = m[1];
  const g = (tag) => { const x = b.match(new RegExp(`<g:${tag}>([^<]*)<\\/g:${tag}>`)); return x ? x[1].trim() : null; };
  feed.push({ title: g('title'), brand: g('brand'), price: parseFloat(g('price')) || 0, salePrice: g('sale_price') ? parseFloat(g('sale_price')) : null, description: g('description') || '', image: g('image_link') || '' });
}
const local = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim(); }

function categoryMatchesFeed(localCat, feedBrand) {
  const lc = norm(localCat);
  const fb = norm(feedBrand);
  if (!fb) return true;
  if (lc.includes(fb) || fb.includes(lc)) return true;
  return false;
}

function findFeedMatch(lp) {
  const localN = norm(lp['Product Name']);
  const localCat = lp.Category || '';

  for (const fp of feed) { if (norm(fp.title) === localN) return fp; }
  for (const fp of feed) {
    const feedN = norm(fp.title);
    if (localN.length >= 8 && feedN.includes(localN) && categoryMatchesFeed(localCat, fp.brand)) return fp;
  }
  for (const fp of feed) {
    const feedN = norm(fp.title);
    if (localN.length >= 10 && feedN.startsWith(localN) && categoryMatchesFeed(localCat, fp.brand)) return fp;
  }
  return null;
}

const updates = [];
const skipped_price = [];
const added = [];

for (const lp of local) {
  const feedMatch = findFeedMatch(lp);
  if (!feedMatch) continue;
  const feedPrice = feedMatch.salePrice || feedMatch.price;
  const nameChanged = lp['Product Name'] !== feedMatch.title;
  const priceChanged = Math.abs(feedPrice - lp.Price) > 0.01;

  if (priceChanged) {
    const pctDiff = Math.abs(feedPrice - lp.Price) / Math.max(lp.Price, 1) * 100;
    if (pctDiff > 50) {
      skipped_price.push({ name: lp['Product Name'], localP: lp.Price, feedP: feedPrice, pct: Math.round(pctDiff) });
      // Still update name if it changed, just not the price
      if (nameChanged && !DRY_RUN) { lp['Product Name'] = feedMatch.title; }
      if (nameChanged) updates.push({ old: lp['Product Name'], new: feedMatch.title, nc: true, pc: false });
      continue;
    }
  }

  if (nameChanged || priceChanged) {
    updates.push({ old: lp['Product Name'], new: feedMatch.title, oldP: lp.Price, newP: feedPrice, nc: nameChanged, pc: priceChanged });
    if (!DRY_RUN) { lp['Product Name'] = feedMatch.title; lp.Price = feedPrice; }
  }
}

const localNorms = new Set(local.map(p => norm(p['Product Name'])));
const missingFeed = [];
for (const fp of feed) {
  const feedN = norm(fp.title);
  let found = false;
  for (const ln of localNorms) {
    if (ln === feedN || ln.includes(feedN) || feedN.includes(ln)) { found = true; break; }
    if (ln.length >= 10 && feedN.startsWith(ln.substring(0, 12))) { found = true; break; }
  }
  if (!found) {
    missingFeed.push(fp);
    if (!DRY_RUN) {
      local.push({ 'Product Name': fp.title, Category: fp.brand || 'Uncategorized', Brand: fp.brand || '', Description: (fp.description || '').substring(0, 200), Size: '', Unit: '', Price: fp.salePrice || fp.price, Image: fp.image || '', status: 'active' });
      added.push(fp.title);
    }
  }
}

console.log('UPDATES: ' + updates.length);
for (const u of updates) {
  if (u.nc) console.log('  NAME: "' + u.old + '" -> "' + u.new + '"');
  if (u.pc) console.log('  PRICE: ' + u.old + ': P' + u.oldP + ' -> P' + u.newP);
}

if (skipped_price.length) {
  console.log('\nSKIPPED (price diff >50%): ' + skipped_price.length);
  for (const s of skipped_price) console.log('  ' + s.name + ': P' + s.localP + ' vs P' + s.feedP + ' (' + s.pct + '% diff)');
}

console.log('\nMISSING FROM LOCAL: ' + missingFeed.length);
for (const f of missingFeed) console.log('  + ' + f.title + ' P' + (f.salePrice || f.price) + ' [' + f.brand + ']');

if (!DRY_RUN && (updates.length || added.length)) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(local, null, 2));
  console.log('\nSaved ' + local.length + ' products');
} else if (DRY_RUN) {
  console.log('\n(Dry run)');
}
console.log('Summary: ' + updates.length + ' updated, ' + added.length + ' added, ' + skipped_price.length + ' price-skipped');

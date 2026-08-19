#!/usr/bin/env node
/**
 * Sync INVENTRAK products.json (and inventory.json product metadata) with the
 * live Sylver Kyte online catalog via the public Facebook product feed.
 *
 *   node scripts/sync-sylver-catalog.js           # apply updates
 *   node scripts/sync-sylver-catalog.js --dry-run # preview only
 *   node scripts/sync-sylver-catalog.js --regen-inventory  # also rebuild inventory.json via seed pipeline
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
const INVENTORY_FILE = path.join(ROOT, 'data', 'inventory.json');
const FEED_URL = 'https://sylverrestaurantandcafesupplier.kyte.site/feed/facebook';

const DRY_RUN = process.argv.includes('--dry-run');
const REGEN_INVENTORY = process.argv.includes('--regen-inventory');

// App category aliases ↔ Kyte g:brand values (feed uses brand as category).
const CATEGORY_ALIASES = {
  'Da Vinci Gourmet Sauces': 'Da Vinci Sauces',
  Matcha: 'MATCHA POWDER',
  Cups: 'Cups and Lid',
  Beans: 'Coffee Beans',
  Powders: 'Da Vinci Powders',
  'Spread Jams Biscuits': 'Spread_Jams_Biscuits',
  'Spread Jams & Biscuits': 'Spread_Jams_Biscuits',
};

const BRAND_PREFIXES = [
  'Da Vinci',
  'Top Creamery',
  'Torani',
  'Dripp',
  'Monin',
  "Beryl's",
  'Acc',
  'DLA',
  'Lotus Biscoff',
  'Jersey',
  'Arla',
  'Essse Cafe',
  'Sylver',
  'Allegro Green Tea',
  'Allegro',
  'Barista Supreme',
  'Original Chicken Pastil by Silong',
  'Spicy Chicken Pastil by Silong',
  'Banquet Dor',
  'Mosa',
  'Everwhip',
  'Vivo',
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 INVENTRAK-sync/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetch(res.headers.location).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          else resolve(data);
        });
      })
      .on('error', reject);
  });
}

function parseFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const block = m[1];
    const get = (tag) => {
      const mm = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return mm ? mm[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    const title = get('g:title');
    const price = Math.round(parseFloat(get('g:price') || '0'));
    const brand = CATEGORY_ALIASES[get('g:brand')] || get('g:brand');
    const description = get('g:description')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n\r\t]/g, '')
      .trim()
      .slice(0, 2000);
    return { title, price, brand, description, link: get('g:link'), image: get('g:image_link') };
  });
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\bsyrup\b/g, 'syurp') // site typo parity (Torani Lemon Syurp)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeSize(s) {
  return norm(String(s || '')
    .replace(/\s+/g, '')
    .replace(/kilogram/g, 'kg')
    .replace(/liter/g, 'l')
    .replace(/milliliter/g, 'ml')
    .replace(/ounce/g, 'oz')
    .replace(/pieces/g, 'pcs'));
}

function extractSize(title) {
  const m = String(title || '').match(/\(([^)]+)\)\s*$/);
  if (m) return m[1].trim();
  const m2 = String(title || '').match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML|OZ|PCS)\b/i);
  if (m2) return `${m2[1]} ${m2[2].toUpperCase()}`;
  return '';
}

function stripBrandPrefix(title) {
  let name = String(title || '').replace(/\([^)]*\)/g, '').trim();
  for (const prefix of BRAND_PREFIXES.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
    if (re.test(name)) {
      name = name.replace(re, '').trim();
      break;
    }
  }
  return name;
}

function webCoreName(item) {
  return stripBrandPrefix(item.title);
}

function appCoreName(product) {
  return stripBrandPrefix(product['Product Name']);
}

function scoreMatch(app, web) {
  const appCat = norm(CATEGORY_ALIASES[app.Category] || app.Category);
  const webCat = norm(web.brand);
  const appSize = normalizeSize(app.Size || extractSize(app['Product Name']));
  const webSize = normalizeSize(extractSize(web.title));
  const appName = norm(appCoreName(app));
  const webName = norm(webCoreName(web));

  let score = 0;

  // Category / brand alignment
  if (appCat === webCat) score += 0.25;
  else if (appCat.includes(webCat) || webCat.includes(appCat)) score += 0.12;

  // Size match (strong signal)
  if (appSize && webSize) {
    if (appSize === webSize) score += 0.35;
    else if (appSize.replace(/^0+/, '') === webSize.replace(/^0+/, '')) score += 0.25;
  } else if (!appSize && !webSize) score += 0.1;

  // Name token overlap
  if (appName === webName) score += 0.45;
  else if (appName.includes(webName) || webName.includes(appName)) score += 0.3;
  else {
    const ta = new Set(appName.split(' ').filter((w) => w.length > 2));
    const tb = new Set(webName.split(' ').filter((w) => w.length > 2));
    let inter = 0;
    ta.forEach((w) => {
      if (tb.has(w)) inter++;
    });
    const union = new Set([...ta, ...tb]).size || 1;
    score += (inter / union) * 0.4;
  }

  // Known alias boosts from manual Sylver cross-check
  const aliasPairs = [
    ['chocolate sipping', 'bellagio chocolate sipping powder'],
    ['frappease powder', 'frappease powder'],
    ['supreme doppio chocolate powder', 'barista supreme doppio chocolate powder'],
    ['original chicken pastil by silong kitchen', 'original chicken pastil by silong'],
    ['spicy chicken pastil by silong kitchen', 'spicy chicken pastil by silong'],
    ['selezione speciale coffee beans', 'essse cafe selezione speciale coffee beans 1 kg'],
    ['arabica coffee beans', 'sylver arabica coffee beans 250g'],
    ['sylver arabica coffee beans', 'sylver arabica coffee beans 1kg'],
    ['ever whip', 'everwhip nondairy whipping cream'],
    ['vivo', 'vivo ambient cream'],
    ['cream chargers', 'mosa cream chargers'],
    ['soda chargers', 'mosa soda chargers'],
    ['sauce pump', 'da vinci sauce pump 15ml'],
    ['syrup pump', 'da vinci syrup pump 7 5ml'],
    ['frozen croissant', 'banquet dor frozen croissant'],
    ['la ricetta speculoos biscuits', 'la ricetta speculoos biscuits'],
    ['allegro matcha powder', 'allegro green tea matcha'],
    ['caramel sauce 2 l', 'da vinci caramel sauce 2l'],
    ['salted caramel 2 l', 'da vinci salted caramel sauce 2l'],
    ['white chocolate 16 5oz', 'torani white chocolate sauce small 16 5 oz'],
    ['chocolate sauce 16 5oz', 'torani chocolate sauce small 16 5oz'],
    ['caramel syrup 750 ml top creamery', 'top creamery caramel syrup 750ml'],
    ['hazelnut syrup 750 ml top creamery', 'top creamery hazelnut syrup 750ml'],
    ['caramel syrup 750 ml torani', 'torani caramel syrup 750ml'],
    ['hazelnut syrup 750 ml torani', 'torani hazelnut syrup 750ml'],
    ['salted caramel 750 ml torani', 'torani salted caramel syrup 750ml'],
    ['salted caramel 750 ml top creamery', 'top creamery salted caramel syrup 750ml'],
    ['happy barn full cream milk', 'happy barn full cream milk 12l'],
    ['mango syrup', 'monin mango syrup 700ml'],
    ['caramel syrup 1 l', 'monin caramel syrup 1l'],
    ['brew with sylver', 'brew with sylver barista 101'],
  ];
  const pairKey = `${appName}|${norm(web.title)}`;
  for (const [a, b] of aliasPairs) {
    if (norm(a) === appName && (norm(b) === norm(web.title) || norm(b) === webName)) score += 0.2;
  }

  return score;
}

function productRowFromWeb(web, existingImage = '') {
  const size = extractSize(web.title);
  let displayName = web.title;
  // Keep Size field separate; strip trailing (size) from name when Size is set
  if (size && displayName.endsWith(`(${size})`)) {
    displayName = displayName.slice(0, -(size.length + 2)).trim();
    if (size) displayName = `${displayName} (${size})`;
  }
  return {
    'Product Name': web.title,
    Category: web.brand,
    Brand: web.brand,
    Description: web.description,
    Size: size,
    Unit: '',
    Price: web.price,
    Image: existingImage,
  };
}

function matchCatalog(products, feed) {
  const usedWeb = new Set();
  const matches = [];
  const unmatchedApp = [];
  const unmatchedWeb = [];

  for (const app of products) {
    let best = null;
    let bestScore = 0;
    let bestIdx = -1;
    feed.forEach((web, i) => {
      if (usedWeb.has(i)) return;
      const sc = scoreMatch(app, web);
      if (sc > bestScore) {
        bestScore = sc;
        best = web;
        bestIdx = i;
      }
    });
    if (bestScore >= 0.62) {
      usedWeb.add(bestIdx);
      matches.push({ app, web: best, score: bestScore });
    } else {
      unmatchedApp.push(app);
    }
  }

  feed.forEach((web, i) => {
    if (!usedWeb.has(i)) unmatchedWeb.push(web);
  });

  return { matches, unmatchedApp, unmatchedWeb };
}

function applyUpdates(products, matches) {
  const byRef = new Map(matches.map((m) => [m.app, m]));
  return products.map((p) => {
    const m = byRef.get(p);
    if (!m) return p;
    const image = p.Image || p.image || '';
    return {
      ...productRowFromWeb(m.web, image),
      ...(p.status && p.status !== 'active' ? { status: p.status } : {}),
    };
  });
}

function updateInventoryMetadata(inventory, updatedProducts) {
  const byId = new Map();
  updatedProducts.forEach((p, idx) => {
    byId.set(idx + 1, p);
  });
  const inv = JSON.parse(JSON.stringify(inventory));
  for (const item of inv.items || []) {
    const id = item.product?.id;
    const src = byId.get(id);
    if (!src) continue;
    item.product.name = src['Product Name'];
    item.product.category = src.Category;
    item.product.brand = src.Brand || '';
    item.product.description = src.Description || '';
    item.product.size = src.Size || '';
    item.product.unit = src.Unit || '';
    item.product.price = src.Price;
    if (src.Image) item.product.image = src.Image;
  }
  return inv;
}

function regenInventoryFromSeed(productsFile) {
  const Database = require('better-sqlite3');
  const { seedDatabase } = require('../src/seed');
  const { dumpSnapshot, transformSnapshot } = require('../src/migrate-firestore');

  const tmpDb = path.join(os.tmpdir(), `inventrak-sync-${Date.now()}.db`);
  const db = new Database(tmpDb);
  db.exec(require('../src/schema'));
  seedDatabase({ db, productsFile });
  const snap = dumpSnapshot(db);
  db.close();
  fs.unlinkSync(tmpDb);
  const datasets = transformSnapshot(snap);
  return datasets['inventory.json'];
}

async function main() {
  console.log(`Fetching Sylver catalog feed…\n  ${FEED_URL}`);
  const xml = await fetch(FEED_URL);
  const feed = parseFeed(xml);
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  const inventory = fs.existsSync(INVENTORY_FILE)
    ? JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'))
    : null;

  const { matches, unmatchedApp, unmatchedWeb } = matchCatalog(products, feed);
  console.log(`\nFeed: ${feed.length} products | App: ${products.length} products`);
  console.log(`Matched: ${matches.length} | App-only: ${unmatchedApp.length} | Web-only: ${unmatchedWeb.length}`);

  const changes = [];
  for (const m of matches) {
    const next = productRowFromWeb(m.web, m.app.Image || '');
    const fields = ['Product Name', 'Category', 'Brand', 'Description', 'Size', 'Price'];
    for (const f of fields) {
      const old = m.app[f];
      const neu = next[f];
      if (old !== neu) changes.push({ name: m.app['Product Name'], field: f, old, new: neu, web: m.web.title });
    }
  }

  console.log(`\nField changes on matched products: ${changes.length}`);
  changes.slice(0, 25).forEach((c) => {
    console.log(`  • ${c.name} → ${c.field}: ${JSON.stringify(c.old)} → ${JSON.stringify(c.new)}`);
  });
  if (changes.length > 25) console.log(`  … and ${changes.length - 25} more`);

  if (unmatchedApp.length) {
    console.log('\nApp products kept as-is (no confident web match):');
    unmatchedApp.forEach((p) => console.log(`  - [${p.Category}] ${p['Product Name']}`));
  }
  if (unmatchedWeb.length) {
    console.log('\nWeb products not matched to existing app rows:');
    unmatchedWeb.forEach((w) => console.log(`  + [${w.brand}] ${w.title} — ₱${w.price}`));
  }

  const updatedProducts = applyUpdates(products, matches);
  // Append genuinely new web products
  for (const web of unmatchedWeb) {
    updatedProducts.push(productRowFromWeb(web, ''));
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — no files written)');
    return;
  }

  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(updatedProducts, null, 2) + '\n');
  console.log(`\nWrote ${updatedProducts.length} products → ${PRODUCTS_FILE}`);

  if (inventory) {
    let nextInv;
    if (REGEN_INVENTORY || updatedProducts.length !== products.length) {
      console.log('Regenerating inventory.json from seed pipeline…');
      nextInv = regenInventoryFromSeed(PRODUCTS_FILE);
    } else {
      nextInv = updateInventoryMetadata(inventory, updatedProducts);
    }
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(nextInv, null, 2) + '\n');
    console.log(`Wrote inventory → ${INVENTORY_FILE}`);
  }

  console.log('\nDone. Run: npm run migrate:check && npm test');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

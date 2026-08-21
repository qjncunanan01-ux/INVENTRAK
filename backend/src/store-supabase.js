// Supabase storage driver for the npm-free server (DB_DRIVER=supabase).
//
// Exposes the same synchronous read/write interface as store-json.js so the
// server code is driver-agnostic.  Because the server's request handlers
// read synchronously but Supabase is async, this driver keeps an in-memory
// cache of every collection (loaded once at init) and syncs each mutation to
// Supabase through a serialized write queue — identical to store-firestore.js.
//
// Environment variables:
//   SUPABASE_URL      – Project URL (e.g. https://xxx.supabase.co)
//   SUPABASE_KEY      – Service role key (or anon key with RLS policies)

const fs = require('fs');
const path = require('path');

// ================================================================
// Table mapping: JSON file name -> Supabase table name
// ================================================================
const TABLES = {
  'products.json':          'products',
  'inventory.json':         'inventory',
  'stock_movements.json':   'movements',
  'order_inquiries.json':   'inquiries',
  'stock_adjustments.json': 'stock_adjustments',
  'stock_transfers.json':   'stock_transfers',
  '@users':                 'users',
  '@sales':                 'sales',
  '@alerts':                'alerts',
  '@verificationCodes':     'verification_codes',
  '@inventoryMeta':         'inventory_meta',
  '@resetTokens':           'reset_tokens',
};

let client = null;  // supabase client
const cache = {};   // table -> { rows: [...], byId: Map }
let writeChain = Promise.resolve();
let ready = false;

// ================================================================
// Helpers
// ================================================================

function tableFor(file) {
  return TABLES[file];
}

function isReady() {
  return ready;
}

function upsertRow(table, id, idx, data) {
  if (!cache[table]) cache[table] = { rows: [], byId: new Map() };
  const entry = { id, idx, data };
  cache[table].byId.set(String(id), entry);
}

function rebuildRows(table) {
  if (!cache[table]) return [];
  cache[table].rows = [...cache[table].byId.values()]
    .sort((a, b) => a.idx - b.idx)
    .map(e => e.data);
  return cache[table].rows;
}

// Load an entire table into cache.
async function loadTable(client, table) {
  const { data, error } = await client.from(table).select('*');
  if (error) throw new Error(`Supabase load ${table}: ${error.message}`);
  const entries = (data || []).map(row => ({
    id: row.id,
    idx: row.idx || 0,
    data: row.data || {},
  }));
  cache[table] = {
    rows: [],
    byId: new Map(entries.map(e => [String(e.id), e])),
  };
  rebuildRows(table);
}

// Upsert the full cache to Supabase (for writes).
async function flushTable(client, table) {
  const rows = cache[table];
  if (!rows) return;

  const { error: delErr } = await client.from(table).delete().neq('id', -999999);
  if (delErr) throw new Error(`Supabase delete ${table}: ${delErr.message}`);

  const allEntries = [...rows.byId.values()];
  if (allEntries.length === 0) return;

  // Batch in groups of 500 (Supabase limit)
  for (let i = 0; i < allEntries.length; i += 500) {
    const batch = allEntries.slice(i, i + 500).map(e => ({
      id: e.id,
      idx: e.idx,
      data: e.data,
    }));
    const { error } = await client.from(table).upsert(batch);
    if (error) throw new Error(`Supabase upsert ${table}: ${error.message}`);
  }
}

// ================================================================
// Public API (same as store-json.js)
// ================================================================

function read(file) {
  const table = tableFor(file);
  if (!table) return null;

  if (file === 'inventory.json') {
    const metaEntry = (cache['inventory_meta'] || cache['@inventoryMeta']) && (cache['inventory_meta'] || cache['@inventoryMeta']).byId.get('_meta');
    const locations = metaEntry ? metaEntry.data : [];
    const items = rebuildRows('inventory');
    if (!items.length && !locations.length) return null;
    return { locations, items };
  }

  const rows = rebuildRows(table);
  return rows.length ? rows : null;
}

function write(file, rows) {
  const table = tableFor(file);
  if (!table) return;

  writeChain = writeChain.then(async () => {
    if (!client) return;

    if (file === 'inventory.json') {
      const locations = (rows && rows.locations) || [];
      const items = (rows && rows.items) || [];

      // Upsert items
      cache[table] = cache[table] || { rows: [], byId: new Map() };
      cache[table].byId.clear();
      items.forEach((item, idx) => {
        const id = (item && item.product && item.product.id) || idx + 1;
        upsertRow(table, id, idx, item);
      });
      rebuildRows(table);

      // Upsert locations meta
      if (!cache['inventory_meta']) cache['inventory_meta'] = { rows: [], byId: new Map() };
      cache['inventory_meta'].byId.set('_meta', { id: '_meta', idx: -1, data: locations });

      // Flush both
      await flushTable(client, table);
      await flushTable(client, 'inventory_meta');
      return;
    }

    // Normal dataset
    cache[table] = cache[table] || { rows: [], byId: new Map() };
    cache[table].byId.clear();
    (rows || []).forEach((row, idx) => {
      const id = row && row.id !== undefined ? row.id : idx + 1;
      upsertRow(table, id, idx, row);
    });
    rebuildRows(table);
    await flushTable(client, table);
  }).catch(err => {
    console.error(`[supabase] write error for ${file}:`, err.message);
  });
}

async function init() {
  if (client) return; // already initialized

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY env vars are required for the Supabase driver.');
  }

  let createClient;
  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch {
    throw new Error('@supabase/supabase-js is not installed — run `npm install @supabase/supabase-js`.');
  }

  client = createClient(supabaseUrl, supabaseKey);

  // Load all tables into cache
  const tables = Object.values(TABLES);
  for (const table of tables) {
    try {
      await loadTable(client, table);
    } catch (err) {
      console.error(`[supabase] Warning: could not load table ${table}: ${err.message}`);
    }
  }

  // Load inventory meta (locations)
  try {
    await loadTable(client, 'inventory_meta');
  } catch {
    // Table might not exist yet
  }

  // Auto-seed from local JSON if core tables are empty
  const products = rebuildRows('products');
  if (products.length === 0) {
    const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');
    try {
      const localProducts = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf8'));
      cache['products'] = cache['products'] || { rows: [], byId: new Map() };
      cache['products'].byId.clear();
      localProducts.forEach((p, idx) => {
        upsertRow('products', idx + 1, idx, p);
      });
      rebuildRows('products');
      await flushTable(client, 'products');
      console.log(`[supabase] Auto-seeded ${localProducts.length} products from local JSON`);

      // Also seed inventory
      try {
        const localInv = JSON.parse(fs.readFileSync(path.join(dataDir, 'inventory.json'), 'utf8'));
        if (localInv && localInv.items) {
          cache['inventory'] = cache['inventory'] || { rows: [], byId: new Map() };
          cache['inventory'].byId.clear();
          localInv.items.forEach((item, idx) => {
            const id = (item && item.product && item.product.id) || idx + 1;
            upsertRow('inventory', id, idx, item);
          });
          rebuildRows('inventory');
          await flushTable(client, 'inventory');

          if (!cache['inventory_meta']) cache['inventory_meta'] = { rows: [], byId: new Map() };
          cache['inventory_meta'].byId.set('_meta', { id: '_meta', idx: -1, data: localInv.locations || [] });
          await flushTable(client, 'inventory_meta');
          console.log(`[supabase] Auto-seeded inventory with ${localInv.items.length} items`);
        }
      } catch { /* no local inventory */ }
    } catch (err) {
      console.error(`[supabase] Could not auto-seed from local JSON: ${err.message}`);
    }
  }

  ready = true;
  console.log(`[supabase] Driver initialized — ${rebuildRows('products').length} products loaded`);
}

module.exports = { read, write, init, isReady };

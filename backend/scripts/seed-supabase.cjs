#!/usr/bin/env node
/**
 * Seed Supabase from local JSON files.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=xxx node scripts/seed-supabase.cjs
 *
 * First: run the SQL schema in Supabase SQL Editor (see supabase-schema.sql).
 */
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_KEY env vars');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const client = createClient(url, key);

const dataDir = process.env.INVENTRAK_DATA_DIR || path.join(__dirname, '..', 'data');

const TABLES = {
  'products.json':          'products',
  'inventory.json':         'inventory',
  'stock_movements.json':   'movements',
  'order_inquiries.json':   'inquiries',
  'stock_adjustments.json': 'stock_adjustments',
  'stock_transfers.json':   'stock_transfers',
};

async function seedTable(file, table) {
  const filePath = path.join(dataDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`  Skipping ${file} (not found)`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (file === 'inventory.json') {
    // Store items
    const items = (raw.items || []).map((item, idx) => ({
      id: (item.product && item.product.id) || idx + 1,
      idx,
      data: item,
    }));

    if (items.length) {
      // Clear existing
      await client.from(table).delete().neq('id', -999999);
      // Insert in batches of 500
      for (let i = 0; i < items.length; i += 500) {
        const { error } = await client.from(table).upsert(items.slice(i, i + 500));
        if (error) throw new Error(`${table}: ${error.message}`);
      }
      console.log(`  ✅ ${table}: ${items.length} items`);
    }

    // Store locations meta
    const locations = raw.locations || [];
    await client.from('inventory_meta').upsert([{
      id: '_meta',
      idx: -1,
      data: locations,
    }]);
    console.log(`  ✅ inventory_meta: ${locations.length} locations`);
    return;
  }

  // Normal dataset
  const rows = (raw || []).map((row, idx) => ({
    id: (row && row.id !== undefined) ? row.id : idx + 1,
    idx,
    data: row,
  }));

  if (!rows.length) {
    console.log(`  Skipping ${table} (empty)`);
    return;
  }

  // Clear existing
  await client.from(table).delete().neq('id', -999999);

  // Insert in batches of 500
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  console.log(`  ✅ ${table}: ${rows.length} rows`);
}

(async () => {
  console.log('Seeding Supabase from local JSON files...\n');

  for (const [file, table] of Object.entries(TABLES)) {
    try {
      await seedTable(file, table);
    } catch (err) {
      console.error(`  ❌ ${table}: ${err.message}`);
    }
  }

  console.log('\nDone!');
})();

#!/usr/bin/env node
/**
 * Create the demo ROLE accounts in the configured cloud database.
 *
 * Why this exists: the four-role model (backend/src/roles.js) added Owner and
 * Super Admin. Local seeds create them automatically, but the live Supabase /
 * Firestore `users` dataset already exists and is never overwritten — so a
 * deployed instance keeps only the accounts it was seeded with, and the Owner /
 * Super Admin demo logins would not work on the live site. Run this once after
 * deploying the role-model change.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/seed-demo-users.cjs
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/seed-demo-users.cjs --reset
 *
 *   --reset  also restores the password + role of an existing demo account
 *            (default: an account that already exists is left completely alone,
 *            so a changed password or an enabled MFA secret is never clobbered).
 *
 * Safety: refuses to run when DISABLE_DEMO_ACCOUNTS=true, because that flag is
 * the operator's explicit "no default accounts in production" switch (OWASP).
 */
const path = require('path');

const { hashPassword } = require('../src/password-hash');

const DEMO_USERS = [
  { id: 1, username: 'admin', password: 'admin123', role: 'admin', email: 'admin@inventrak.com' },
  { id: 2, username: 'customer', password: 'customer123', role: 'customer', email: 'customer@example.com' },
  { id: 3, username: 'staff', password: 'staff123', role: 'staff', email: 'staff@inventrak.com' },
  { id: 4, username: 'owner', password: 'owner123', role: 'owner', email: 'owner@inventrak.com' },
  { id: 5, username: 'superadmin', password: 'super123', role: 'super_admin', email: 'superadmin@inventrak.com' },
];

const reset = process.argv.includes('--reset');

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function seedSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) fail('Set SUPABASE_URL and SUPABASE_KEY (or use --firestore).');

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key);

  const { data, error } = await client.from('users').select('*');
  if (error) fail(`Supabase load users: ${error.message}`);

  const existing = new Map(
    (data || []).map((row) => [String((row.data || {}).username || '').toLowerCase(), row])
  );

  // `idx` must be unique across the whole table — the store sorts by it and a
  // collision makes two rows fight over one position (this bit the live DB
  // once: superadmin and a Google signup both got idx 5). Take the highest
  // existing idx and count up for every new row.
  let nextIdx = (data || []).reduce((max, row) => Math.max(max, Number(row.idx) || 0), 0) + 1;

  const toUpsert = [];
  for (const demo of DEMO_USERS) {
    const found = existing.get(demo.username);
    if (found && !reset) {
      console.log(`  • ${demo.username}: exists (role=${(found.data || {}).role}) — left untouched`);
      continue;
    }
    const user = found && reset
      ? { ...(found.data || {}), role: demo.role, password: hashPassword(demo.password) }
      : {
          ...demo,
          password: hashPassword(demo.password),
          email_verified: true,
          phone: null,
          created_at: new Date().toISOString(),
        };
    toUpsert.push({
      id: found ? found.id : demo.id,
      idx: found ? found.idx || 0 : nextIdx++,
      data: user,
    });
    console.log(`  ✅ ${demo.username}: ${found ? 'reset' : 'created'} as ${demo.role}`);
  }

  if (toUpsert.length) {
    const { error: upsertError } = await client.from('users').upsert(toUpsert);
    if (upsertError) fail(`Supabase upsert users: ${upsertError.message}`);
  }
  console.log(`\nDone — ${toUpsert.length} account(s) written.`);
}

async function seedFirestore() {
  const store = require('../src/store-firestore');
  if (typeof store.init === 'function') await store.init();
  const users = store.read('@users') || [];
  const byName = new Map(users.map((u) => [String(u.username || '').toLowerCase(), u]));

  let added = 0;
  for (const demo of DEMO_USERS) {
    const found = byName.get(demo.username);
    if (found && !reset) {
      console.log(`  • ${demo.username}: exists (role=${found.role}) — left untouched`);
      continue;
    }
    const next = {
      ...(found || {}),
      ...demo,
      password: hashPassword(demo.password),
      email_verified: true,
      phone: (found && found.phone) || null,
      created_at: (found && found.created_at) || new Date().toISOString(),
    };
    if (found) Object.assign(found, next);
    else users.push(next);
    added += 1;
    console.log(`  ✅ ${demo.username}: ${found ? 'reset' : 'created'} as ${demo.role}`);
  }

  store.write('@users', users);
  if (typeof store.flush === 'function') await store.flush();
  console.log(`\nDone — ${added} account(s) written.`);
}

(async () => {
  if (process.env.DISABLE_DEMO_ACCOUNTS === 'true') {
    fail('DISABLE_DEMO_ACCOUNTS=true — refusing to create demo accounts in production.');
  }

  console.log(`Seeding demo role accounts${reset ? ' (with --reset)' : ''}...\n`);
  const driver = (process.env.DB_DRIVER || '').toLowerCase();
  if (driver === 'firestore' || process.argv.includes('--firestore')) {
    await seedFirestore();
  } else {
    await seedSupabase();
  }
})().catch((err) => fail(err.message));

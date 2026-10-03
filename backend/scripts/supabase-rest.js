// Minimal PostgREST client for the maintenance scripts.
//
// WHY NOT THE DRIVER
// store-supabase.js caches a whole table in memory and flushes it with a
// delete-all followed by an upsert. That is right for the running server and
// exactly wrong for a maintenance script: the delete-all window means a script
// that crashes mid-write can leave a table empty, and it rewrites rows nobody
// asked it to touch. These scripts therefore read what they need and PATCH
// only the specific rows they change.
//
// Shared by backfill-customers.js and backfill-costs.js so the two agree on
// how the project is addressed and how auth is attached.
function requireConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const rest = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  return { rest, headers };
}

async function readAll(rest, headers, table, select = 'id,idx,data', extra = '') {
  const res = await fetch(`${rest}/${table}?select=${encodeURIComponent(select)}${extra}`, { headers });
  if (!res.ok) throw new Error(`reading ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchRow(rest, headers, table, id, data) {
  const res = await fetch(`${rest}/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`writing ${table} id=${id}: ${res.status} ${await res.text()}`);
}

async function insertRows(rest, headers, table, rows) {
  if (!rows.length) return;
  const res = await fetch(`${rest}/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`inserting ${table}: ${res.status} ${await res.text()}`);
}

module.exports = { requireConfig, readAll, patchRow, insertRows };
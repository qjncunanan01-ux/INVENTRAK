// Pure parsing/formatting helpers for the Products page, extracted so the page
// body reads as orchestration instead of CSV handling. Dependency-free on
// purpose, so each function can be reasoned about (and tested) on its own.

// Only numeric characters (plus a single decimal point) can ever enter a price
// or cost field — letters/symbols are stripped as the user types.
export function sanitizePrice(value) {
  let v = String(value || '').replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  return v;
}

// Parses pasted/uploaded CSV text into [{ name, price }] rows.
// Accepted layouts (header row optional):
//   Product Name,Price
//   id,name,price
//   Name\tPrice  (tab-separated)
//   Name,1,234.50
export function parseCsvRows(text) {
  const rows = [];
  const lines = String(text || '').split(/\r?\n/);
  let isHeader = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Split on tab first (Excel paste), then on the LAST comma that is
    // followed by a number so product names containing commas survive.
    let cols;
    if (line.includes('\t')) cols = line.split('\t');
    else {
      const m = line.match(/^(.*?)[,\t]([₱P]?\s*[\d,.]+)$/);
      if (!m) continue;
      cols = [m[1].trim(), m[2].trim()];
    }
    // A 3-column tab row (id\tname\tprice) carries the name in the MIDDLE
    // column; the first is the numeric id we don't need for matching.
    const name = String(cols.length >= 3 ? cols[1] : cols[0] || '').trim().replace(/^["']|["']$/g, '');
    const priceStr = String(cols[cols.length - 1] || '').replace(/[^\d.]/g, '');
    const price = Number(priceStr);
    if (!name || !Number.isFinite(price)) continue;
    // Skip a header row like "name" / "Product Name" / "price" — only on
    // the first non-empty line, and only when the name column is exactly the
    // header word.
    if (isHeader && /^(name|product\s*name|price|id)$/i.test(name)) {
      isHeader = false;
      continue;
    }
    isHeader = false;
    rows.push({ name, price });
  }
  return rows;
}

// The current catalog as a name,price CSV — the template the admin fills in
// with real supplier prices and re-imports.
export function priceTemplateCsv(products) {
  const rows = Array.isArray(products) ? products.map(p => `${p.name},${p.price}`) : [];
  return 'Product Name,Price\n' + rows.join('\n');
}

// Triggers a client-side download of `csv` as `filename` (no server round trip).
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

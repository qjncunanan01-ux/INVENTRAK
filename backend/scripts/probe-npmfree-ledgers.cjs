#!/usr/bin/env node
// Probe the actual npm-free route table for the four spec'd ledger paths
// that the audit flags as "no matching Express route". The audit's npm-free
// extractor only matches exact/substring literals from the dispatcher, so this
// program searches the file text directly for the route fragments both in the
// dispatcher and in the remedy loaders that back those dispatchers.
const fs = require('fs');
const src = fs.readFileSync('src/server_npmfree.js', 'utf8');
const markers = [
  '=====\n  if (req.method === \'POST\' && url.split(\'?\')[0] === \'/api/unit-conversions\')',
  '// ================= NOTIFICATION LEDGER (admin) =================',
  '// ================= BACK ORDERS (admin + customer) =================',
  '// ================= CORRECTION REQUESTS (admin) =================',
];
const offsets = {};
for (const m of markers) {
  const i = src.indexOf(m);
  offsets[m] = i >= 0 ? i : null;
}
console.log('MARKER_OFFSETS', Object.keys(offsets).length);
Object.entries(offsets).forEach(([m, i]) => {
  console.log(`  ${i === null ? 'MISSING' : i} | ${m.replace(/\n/g, ' | ')}`);
});

// Print a window around each marker so we can see the actual matcher text.
for (const m of markers) {
  const i = offsets[m];
  if (i === null) continue;
  const windowLen = 1200;
  const start = Math.max(0, i - 0);
  const end = Math.min(src.length, i + windowLen);
  console.log('\n---- WINDOW @ ' + i + ' ----');
  console.log(src.slice(start, end));
  console.log('---- END WINDOW ----\n');
}
NODE
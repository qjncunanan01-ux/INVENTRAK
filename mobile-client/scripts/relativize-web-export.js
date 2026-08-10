// Post-processes `dist/` from `expo export --platform web` so every asset
// reference is RELATIVE instead of root-absolute ("/_expo/...", "/assets/...").
// Expo emits absolute paths which break when the site is served under a
// subpath (GitHub Pages project site: /INVENTRAK/app/). This rewrites:
//   index.html:  src="/_expo/...  ->  src="./_expo/...
//   JS/CSS:      "/assets/...     ->  "./assets/...
//                "/_expo/...      ->  "./_expo/...
// Only the exact leading-slash asset prefixes are touched, so API URLs
// (https://...) and relative imports are left alone.
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

// Rewrite root-absolute asset URLs to relative, both quote styles:
//   "/assets/...   ->  "./assets/...
//   '/_expo/...    ->  './_expo/...
function rewriteFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s
    .replace(/"\/(?:assets|_expo)\//g, (m) => m[0] + '.' + m.slice(1))
    .replace(/'\/(?:assets|_expo)\//g, (m) => m[0] + '.' + m.slice(1));
  if (s !== before) fs.writeFileSync(file, s);
  return s !== before;
}

let changed = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(html|js|css)$/.test(entry.name)) {
      if (rewriteFile(p)) changed++;
    }
  }
}

walk(DIST);
console.log(`relativized ${changed} file(s) in ${DIST}`);

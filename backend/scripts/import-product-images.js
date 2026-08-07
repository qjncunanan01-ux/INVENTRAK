// Imports the product photo library into backend/images/ with clean, URL-safe
// filenames and writes backend/data/product-images.json (the product-name ->
// image manifest used to populate the `image` field on products).
//
// The source library is the downloaded category folders (e.g. from the
// supplier's site); this script flattens every file into backend/images/ as
// `<category-slug>--<file-slug>.<ext>` so names are stable and collision-free,
// and records the exact mapping the 8 catalog products should use.
//
// Usage:
//   node scripts/import-product-images.js --src "C:/path/to/images" [--dest backend/images]
// Default --src is the user's Downloads folder copy.
//
// After running: the 8 products get their `image` field from the manifest via
// the product-image seeding in products.json (Image key) — re-run whenever the
// library grows.
const fs = require('fs');
const path = require('path');

const SRC_FLAG = process.argv.indexOf('--src');
const DEST_FLAG = process.argv.indexOf('--dest');
const SRC = SRC_FLAG >= 0
  ? process.argv[SRC_FLAG + 1]
  : 'C:/Users/Jico/Downloads/INVENTRAK-main (2)/images';
const DEST = DEST_FLAG >= 0
  ? process.argv[DEST_FLAG + 1]
  : path.join(__dirname, '..', 'images');

// Sniff real image type from magic bytes (some files lack extensions).
function sniffExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
  return '';
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// The 8 catalog products -> exact source file (relative to SRC).
const PRODUCT_MAP = {
  'Butterscotch Sauce': 'Da Vinci Sauces _ Sylver Restaurant and Cafe Supplier/Butterscotch.jpg',
  'Caramel Sauce': 'Da Vinci Sauces _ Sylver Restaurant and Cafe Supplier/Caramel 2L.jpg',
  'Chocolate Sauce': 'Da Vinci Sauces _ Sylver Restaurant and Cafe Supplier/Chocolate 2L.jpg',
  'Da Vinci Matcha Powder': 'MATCHA POWDER _ Sylver Restaurant and Cafe Supplier/Da vinci.jpg',
  'Arla Full Cream Milk': 'Full Cream Milk _ Sylver Restaurant and Cafe Supplier/Arla Full Cream Milk (12L).jpg',
  'Dabba Elegant Cups 12oz': 'Cups and Lid _ Sylver Restaurant and Cafe Supplier/Dabba Elegant Cups 12oz (50PCS).jpg',
  'Sylver Arabica Coffee Beans': 'Coffee Beans _ Sylver Restaurant and Cafe Supplier/Arabica Coffee Beans 1KG.jpg',
  'Frappase Powder': 'Da Vinci Powders _ Sylver Restaurant and Cafe Supplier/Frappease Powder 1.5KG',
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source images folder not found: ${SRC}`);
    process.exit(1);
  }
  fs.mkdirSync(DEST, { recursive: true });

  // Category slug = the top-level folder name with the supplier suffix trimmed.
  const files = walk(SRC);
  const destByName = new Map(); // dest filename -> source
  let copied = 0;
  let skipped = 0;

  for (const src of files) {
    const rel = path.relative(SRC, src);
    const parts = rel.split(path.sep);
    const categorySlug = slug((parts[0] || 'misc').replace(/ ?_ .*/, ''));
    const base = path.basename(src);
    const extMatch = base.match(/\.(jpe?g|png|gif|webp)$/i);
    let name = path.basename(src, extMatch ? '.' + extMatch[1] : '');
    let ext = extMatch ? '.' + extMatch[1].toLowerCase() : '';
    const head = fs.readFileSync(src);
    if (!/^\.(jpe?g|png|gif|webp)$/.test(ext)) ext = sniffExt(head); // recover missing/odd extensions
    if (!ext) {
      console.error(`  skipping non-image: ${rel}`);
      skipped += 1;
      continue;
    }
    const destName = `${categorySlug}--${slug(name)}${ext}`;
    destByName.set(destName, rel);
    const dest = path.join(DEST, destName);
    if (!fs.existsSync(dest) || fs.readFileSync(dest).equals(head) === false) {
      fs.writeFileSync(dest, head);
      copied += 1;
    }
  }

  // Map the 8 catalog products to their copied filenames.
  const products = {};
  for (const [productName, srcRel] of Object.entries(PRODUCT_MAP)) {
    const srcPath = path.join(SRC, srcRel);
    if (!fs.existsSync(srcPath)) {
      console.error(`  MANIFEST MISS: ${productName} -> ${srcRel} not found`);
      continue;
    }
    const parts = srcRel.split(path.sep);
    const categorySlug = slug((parts[0] || 'misc').replace(/ ?_ .*/, ''));
    const base = path.basename(srcRel);
    const extMatch = base.match(/\.(jpe?g|png|gif|webp)$/i);
    let name = path.basename(base, extMatch ? '.' + extMatch[1] : '');
    let ext = extMatch ? '.' + extMatch[1].toLowerCase() : '';
    if (!/^\.(jpe?g|png|gif|webp)$/.test(ext)) ext = sniffExt(fs.readFileSync(srcPath));
    const destName = `${categorySlug}--${slug(name)}${ext}`;
    products[productName] = destName;
  }

  const manifestPath = path.join(__dirname, '..', 'data', 'product-images.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: SRC,
    products,
    totalFiles: destByName.size,
  }, null, 2));

  console.log(`Copied ${copied} (${skipped} non-images skipped) -> ${DEST}`);
  console.log(`Total image files: ${destByName.size}`);
  console.log('--- 8 product mappings ---');
  for (const [name, file] of Object.entries(products)) {
    console.log(`  ${name} -> /images/${file}`);
  }
  console.log(`Manifest: ${manifestPath}`);
}

main();

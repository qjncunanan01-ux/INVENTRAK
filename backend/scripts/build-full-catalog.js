// Builds the full product catalog from the supplier image library.
//
// The image library (a folder per category, e.g. "Da Vinci Sauces _ Sylver
// Restaurant and Cafe Supplier/Chocolate 2L.jpg") is the source of truth for
// product names/categories/sizes. Every image already has a committed,
// slugified copy in backend/images (see import-product-images.js); this script
// maps each source file back to its committed image, derives the product row,
// and merges it with the 8 hand-curated catalog products (whose real prices
// are kept).
//
// New products get an ESTIMATED price from the per-category price map below —
// a starting point the admin can edit on the Products page. Prices here are
// PHP wholesale-ish placeholders, not verified supplier prices.
//
// Usage: node scripts/build-full-catalog.js
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/Jico/Downloads/INVENTRAK-main (2)/images';
const IMAGES_DIR = path.join(__dirname, '..', 'images');
const OUT = path.join(__dirname, '..', 'data', 'products.json');

function slug(s) {
  return s
    .toLowerCase()
    .replace(/'/g, 's')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Estimated starter price (PHP) per category folder name.
const PRICE_MAP = {
  Achievers: 420,
  'Baking Chocolate': 820,
  'Chicken Pastil': 150,
  'Coffee Beans': 1250,
  'Condense Milk': 700,
  'Cups and Lid': 200,
  'Da Vinci BeverageMix': 620,
  'Da Vinci Mixologies': 620,
  'Da Vinci Powders': 950,
  'Da Vinci Sauces': 1000,
  'Da Vinci Syrup': 460,
  'Dripp Flavours': 460,
  'Full Cream Milk': 1120,
  'MATCHA POWDER': 1175,
  Monin: 520,
  'Non Dairy Creamer': 700,
  Others: 300,
  Others1: 400,
  'Plant Based Milk': 460,
  Spread_Jams_Biscuits: 500,
  'Top Creamery': 460,
  Torani: 460,
  'Whip Cream': 350,
};

// Keep the 8 curated products (real names/prices/sizes) as the merge base.
// They are the rows whose image is one of the 8 originally hand-mapped files.
const CURATED_IMAGES = new Set([
  'da-vinci-sauces--butterscotch.jpg',
  'da-vinci-sauces--caramel-2l.jpg',
  'da-vinci-sauces--chocolate-2l.jpg',
  'matcha-powder--da-vinci.jpg',
  'full-cream-milk--arla-full-cream-milk-12l.jpg',
  'cups-and-lid--dabba-elegant-cups-12oz-50pcs.jpg',
  'coffee-beans--arabica-coffee-beans-1kg.jpg',
  'da-vinci-powders--frappease-powder-1-5kg.jpg',
]);

// Normalize the 8 curated rows' legacy category names onto the supplier
// library's taxonomy, so the whole catalog uses one clean category set
// (e.g. "Da Vinci Gourmet Sauces" -> "Da Vinci Sauces", "Cups" ->
// "Cups and Lid") instead of 28 near-duplicate categories.
const CATEGORY_ALIASES = {
  'Da Vinci Gourmet Sauces': 'Da Vinci Sauces',
  Matcha: 'MATCHA POWDER',
  Cups: 'Cups and Lid',
  Beans: 'Coffee Beans',
  Powders: 'Da Vinci Powders',
  'Full Cream Milk': 'Full Cream Milk',
};
const allExisting = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const existing = allExisting.filter((p) =>
  CURATED_IMAGES.has(String(p.Image || '').replace('/images/', ''))
);
const seenImages = new Set(existing.map((p) => String(p.Image || '').replace('/images/', '')));

// Derive "Size" from a filename like "Chocolate 2L.jpg" / "Beryl_s Dark Chocolate 1KG.jpg".
function deriveSize(filename) {
  const m = filename.match(/\(([^)]+)\)/);
  if (m) return m[1].trim();
  const m2 = filename.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML|OZ|PCS)\b/i);
  if (m2) return `${m2[1]} ${m2[2].toUpperCase()}`;
  return '';
}

function cleanName(base) {
  // Strip the trailing size token so the product name reads naturally,
  // e.g. "Chocolate 2L" -> "Chocolate", "1KG" suffix dropped. OZ stays in the
  // name because cup sizes like "Dabba Elegant Cups 12oz" carry it as the
  // product's identity (12oz vs 16oz are DIFFERENT products).
  return base
    .replace(/\([^)]*\)/g, '')
    .replace(/\s*\d+(?:\.\d+)?\s*(KG|G|L|ML|PCS)\s*$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const added = [];
const dirs = fs.readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));

for (const dir of dirs) {
  const category = dir.name.split('_ Sylver')[0].trim();
  const catSlug = slug(category);
  // Some source files lack an extension (the image importer sniffed their
  // magic bytes and stored them as .jpg) — treat every non-hidden entry as an
  // image candidate.
  const files = fs.readdirSync(path.join(SRC, dir.name))
    .filter((f) => !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b));

  for (const f of files) {
    // Strip a REAL image extension explicitly — path.extname misreads sizes
    // like "1.5KG" as an extension, which would corrupt the slug.
    const base = path.basename(f).replace(/\.(jpe?g|png|webp)$/i, '');
    // Skip obvious re-download variants like "(3KG)(1).jpg" — the same
    // product photographed/downloaded twice (they'd collide on name+size).
    if (/\)\(\d+\)$/.test(base)) continue;
    const imgSlug = slug(base);
    const imageFile = `${catSlug}--${imgSlug}.jpg`;
    const committed = fs.existsSync(path.join(IMAGES_DIR, imageFile))
      ? imageFile
      : fs.readdirSync(IMAGES_DIR).find((x) => x.startsWith(`${catSlug}--${imgSlug}.`));

    if (!committed) {
      console.error(`WARN: no committed image for ${dir.name}/${f}`);
      continue;
    }
    if (seenImages.has(committed)) continue; // one of the 8 curated rows

    const name = cleanName(base);
    added.push({
      'Product Name': name,
      'Category': category,
      'Brand': '',
      'Description': '',
      'Size': deriveSize(base),
      'Unit': '',
      'Price': PRICE_MAP[category] || 400,
      'Image': `/images/${committed}`,
    });
    seenImages.add(committed);
  }
}

const merged = [...existing, ...added].map((p) => ({
  ...p,
  'Category': CATEGORY_ALIASES[p['Category']] || p['Category'],
}));

// Disambiguate duplicate display names: when the same name appears more than
// once (e.g. "Caramel" 2L and 500ml, "Vanilla" 750ML/760ML), append the size
// so customers and admins can tell the SKUs apart. If the name+size still
// collides (same product sold under two brands, e.g. Torani vs Top Creamery
// "Caramel Syrup 750ML"), append the category as the brand qualifier.
const nameCount = {};
merged.forEach((p) => {
  const key = (p['Product Name'] || '').toLowerCase();
  nameCount[key] = (nameCount[key] || 0) + 1;
});
merged.forEach((p) => {
  if (nameCount[(p['Product Name'] || '').toLowerCase()] > 1) {
    p['Product Name'] = p['Size'] ? `${p['Product Name']} (${p['Size']})` : p['Product Name'];
  }
});
const nameSizeCount = {};
merged.forEach((p) => {
  const key = `${(p['Product Name'] || '').toLowerCase()}|${p['Size'] || ''}`;
  nameSizeCount[key] = (nameSizeCount[key] || 0) + 1;
});
merged.forEach((p) => {
  const key = `${(p['Product Name'] || '').toLowerCase()}|${p['Size'] || ''}`;
  if (nameSizeCount[key] > 1 && p['Category']) {
    p['Product Name'] = `${p['Product Name']} - ${p['Category']}`;
  }
});

fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
console.log(`Wrote ${merged.length} products (${existing.length} curated + ${added.length} from images) to ${OUT}`);

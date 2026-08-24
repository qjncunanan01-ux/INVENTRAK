#!/usr/bin/env node
/**
 * Extract brand names from product names for products missing brands.
 */
const fs = require('fs');
const path = require('path');

const productsFile = path.join(__dirname, '..', 'data', 'products.json');
const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));

// Known brand patterns (order matters — first match wins)
const brandPatterns = [
  { pattern: /^da vinci/i, brand: 'Da Vinci' },
  { pattern: /^torani/i, brand: 'Torani' },
  { pattern: /^monin/i, brand: 'Monin' },
  { pattern: /^arla/i, brand: 'Arla' },
  { pattern: /^beryl/i, brand: "Beryl's" },
  { pattern: /^top creamery/i, brand: 'Top Creamery' },
  { pattern: /^dripp/i, brand: 'Dripp' },
  { pattern: /^allegro/i, brand: 'Allegro' },
  { pattern: /^acc /i, brand: 'Achievers' },
  { pattern: /^achievers/i, brand: 'Achievers' },
  { pattern: /^barista supreme/i, brand: 'Barista Supreme' },
  { pattern: /^yarras?/i, brand: "Yarra's Farm" },
  { pattern: /^dl[ai]/i, brand: 'DLA' },
  { pattern: /^friesche vlag/i, brand: 'Friesche Vlag' },
  { pattern: /^dutchie/i, brand: 'Dutchie' },
  { pattern: /^hershey/i, brand: "Hershey's" },
  { pattern: /^nestle/i, brand: 'Nestle' },
  { pattern: /^nestlé/i, brand: 'Nestle' },
  { pattern: /^cocoa town/i, brand: 'Cocoa Town' },
  { pattern: /^meiji/i, brand: 'Meiji' },
  { pattern: /^lance/i, brand: 'Lance' },
  { pattern: /^belgian/i, brand: 'Belgian' },
  { pattern: /^java city/i, brand: 'Java City' },
  { pattern: /^boh/i, brand: 'Boh' },
  { pattern: /^twinings/i, brand: 'Twinings' },
  { pattern: /^lipton/i, brand: 'Lipton' },
  { pattern: /^illy/i, brand: 'Illy' },
  { pattern: /^starbucks/i, brand: 'Starbucks' },
  { pattern: /^mikee/i, brand: 'Mikee' },
  { pattern: /^sarangani/i, brand: 'Sarangani' },
  { pattern: /^spring home/i, brand: 'Spring Home' },
  { pattern: /^fujiya/i, brand: 'Fujiya' },
  { pattern: /^milkita/i, brand: 'Milkita' },
  { pattern: /^hightop/i, brand: 'Hightop' },
  { pattern: /^creamery made/i, brand: 'Creamery Made' },
  { pattern: /^dole/i, brand: 'Dole' },
  { pattern: /^del monte/i, brand: 'Del Monte' },
  { pattern: /^campo/i, brand: 'Campo' },
  { pattern: /^bakersfield/i, brand: 'Bakersfield' },
  { pattern: /^master foods/i, brand: 'Master Foods' },
  { pattern: /^master martini/i, brand: 'Master Martini' },
  { pattern: /^chef.s choice/i, brand: "Chef's Choice" },
  { pattern: /^puregold/i, brand: 'Puregold' },
  { pattern: /^sm bonus/i, brand: 'SM Bonus' },
  { pattern: /^uht/i, brand: 'UHT' },
  { pattern: /^callebaut/i, brand: 'Callebaut' },
  { pattern: /^van houten/i, brand: 'Van Houten' },
  { pattern: /^silong kitchen/i, brand: 'Silong Kitchen' },
  { pattern: /^essse/i, brand: 'Essse Cafe' },
  { pattern: /^marie/i, brand: 'Marie' },
  { pattern: /^dabba/i, brand: 'Dabba' },
  { pattern: /^emborg/i, brand: 'Emborg' },
  { pattern: /^happy barn/i, brand: 'Happy Barn' },
  { pattern: /^malaysian/i, brand: 'Malaysian' },
  { pattern: /^brew with sylver/i, brand: 'Sylver' },
  { pattern: /^banquet dor/i, brand: 'Banquet Dor' },
  { pattern: /^mosa/i, brand: 'Mosa' },
  { pattern: /^farm fresh/i, brand: 'Farm Fresh' },
  { pattern: /^milklab/i, brand: 'Milklab' },
  { pattern: /^oatbedient/i, brand: 'Oatbedient' },
  { pattern: /^oatside/i, brand: 'Oatside' },
  { pattern: /^so good/i, brand: 'So Good' },
  { pattern: /^doking/i, brand: 'Doking' },
  { pattern: /^jersey/i, brand: 'Jersey' },
  { pattern: /^la ricetta/i, brand: 'La Ricetta' },
  { pattern: /^lotus biscoff/i, brand: 'Lotus Biscoff' },
  { pattern: /^lotus/i, brand: 'Lotus' },
  { pattern: /^milin/i, brand: 'Milin' },
  { pattern: /^nutella/i, brand: 'Nutella' },
  { pattern: /^ferrero/i, brand: 'Ferrero' },
  { pattern: /^oreo/i, brand: 'Oreo' },
  { pattern: /^everwhip/i, brand: 'Everwhip' },
  { pattern: /^vivo/i, brand: 'Vivo' },
  { pattern: /^sylver/i, brand: 'Sylver' },
];

function extractBrand(product) {
  const name = product.name || product['Product Name'] || '';

  // Try known patterns
  for (const { pattern, brand } of brandPatterns) {
    if (pattern.test(name)) return brand;
  }

  // For simple flavor-only names (e.g., "Caramel (500 ML)", "Hazelnut (760 ML)")
  // These are likely Da Vinci or generic — use the category
  const cat = product.category || product.Category || '';
  if (cat.includes('Da Vinci')) return 'Da Vinci';
  if (cat.includes('Torani')) return 'Torani';
  if (cat.includes('Dripp')) return 'Dripp';
  if (cat.includes('Monin')) return 'Monin';
  if (cat.includes('Top Creamery')) return 'Top Creamery';
  if (cat.includes('Achievers')) return 'Achievers';
  if (cat.includes('Cups') || cat.includes('Lid')) return 'Generic';
  if (cat.includes('Others')) return 'Sylver';

  return 'Sylver';
}

// Process products
let updated = 0;
let skipped = 0;

products.forEach((product) => {
  const brand = product.brand || product.Brand || '';
  if (brand.trim().length > 0) {
    skipped++;
    return;
  }

  const newBrand = extractBrand(product);
  if (newBrand) {
    if (product.brand !== undefined) {
      product.brand = newBrand;
    } else if (product.Brand !== undefined) {
      product.Brand = newBrand;
    } else {
      product.brand = newBrand;
    }
    updated++;
  }
});

// Write back
fs.writeFileSync(productsFile, JSON.stringify(products, null, 2), 'utf8');

console.log(`Updated ${updated} products with brands`);
console.log(`Skipped ${skipped} products (already had brands)`);
console.log(`Total: ${products.length} products`);

// Verify no empty brands remain
const stillEmpty = products.filter(p => !(p.brand || p.Brand || '').trim());
console.log(`\nRemaining without brand: ${stillEmpty.length}`);

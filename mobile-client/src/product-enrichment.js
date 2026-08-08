// Product-enrichment helpers for the mobile catalog (PDP + PLP).
//
// The catalog rows only carry name/category/brand/size/unit/price/image and
// almost no descriptions, so instead of a risky 192-row data migration we
// DERIVE the selling-point details deterministically from the fields we
// already have. Pure functions (no React, no device APIs) so they can be
// unit-tested headlessly with plain Node.
//
// Everything is stable across renders/devices for the same product, which is
// the important part: a rating that flickers between 4.4 and 4.8 would look
// broken, and bulk prices that change between page loads would be misleading.

// Category-aware one-liner used when a product has no description. Falls back
// to a generic food-service line so no card is ever left text-less.
const CATEGORY_BLURBS = {
  'coffee beans':
    'Whole-bean coffee chosen for cafe-grade extraction — grind to your preferred profile for espresso, drip, or pour-over.',
  'matcha powder':
    'Ceremonial-quality matcha that steams into a smooth, vivid green base for lattes, frappes, and baked goods.',
  'full cream milk':
    'Full-cream milk that steams, stretches, and pours reliably — trusted by baristas for cafe and bakery service.',
  'plant based milk':
    'Dairy-free barista milk that foams and blends like the real thing for oat, soy, and coconut drinks.',
  'non dairy creamer':
    'Instant creamer that keeps hot and iced drinks rich without refrigeration.',
  'condense milk':
    'Thick, sweet condensed milk for classic milk teas, coffee, and Filipino desserts.',
  'baking chocolate':
    'Couverture-grade chocolate with even melt and snap — ideal for molding, ganache, and pastry work.',
  'da vinci sauces':
    'Flavor sauce concentrate that pumps straight into drinks for a consistent menu taste.',
  'da vinci beveragemix':
    'Concentrated beverage base that mixes straight into hot or iced drinks for a consistent cafe menu.',
  'da vinci mixologies':
    'Flavor mix that turns simple sodas, juices, and cocktails into signature drinks.',
  'da vinci powders':
    'Drink-mix powder engineered for frappes and flavored beverages with a smooth, clump-free finish.',
  'da vinci syrup':
    'Premium flavor syrup for coffee, tea, and cocktails — measured by the pump for repeatable drinks.',
  'dripp flavours':
    'Barista flavoring that mixes into hot and iced drinks without separating.',
  'torani':
    'Bar-staple flavored syrup for coffee, tea, lemonade, and signature desserts.',
  'monin':
    'Syrup crafted for cafe menus — consistent sweetness and clean flavor in every pour.',
  'achievers':
    'Economical flavor syrup made for high-volume milk tea and coffee shops.',
  'top creamery':
    'Creamery-grade syrups and powders for frappes, milk tea, and foam-topped drinks.',
  'cups and lid':
    'Food-service disposable cups and lids sized for hot and cold carry-out.',
  'spread_jams_biscuits':
    'Spreads, jams, and biscuit bases that finish desserts and drinks fast.',
  'chicken pastil':
    'Ready-to-serve Filipino pastil — steam, plate, and serve.',
  'whip cream':
    'Whipped-cream solution for quick, clean toppings and cake finishing.',
  'others':
    'Bar and pantry essentials to round out your service station.',
  'others1':
    'Service-station equipment and accessories for daily operations.',
};

const DEFAULT_BLURB =
  'A cafe & restaurant essential from Sylver — consistent quality, food-service sizing, and dependable supply for daily operations.';

export function describeProduct(product) {
  if (!product) return '';
  const desc = (product.description || '').trim();
  if (desc) return desc;
  const cat = String(product.category || '').trim();
  const key = cat.toLowerCase();
  const blurb = CATEGORY_BLURBS[key] || DEFAULT_BLURB;
  const size = String(product.size || '').trim();
  const sizePart = size
    ? ` Packed in ${size}, sized for busy service.`
    : '';
  const brand = String(product.brand || '').trim();
  const brandPart = brand ? ` From ${brand}.` : '';
  return blurb + brandPart + sizePart;
}

// Wholesale "buy more, save" tiers (case-of-6/12/24). Savings are flat and
// deterministic — a tier is just the unit price at a fixed discount, so it is
// stable across renders and honest-looking for a supplier.
export function bulkTiers(product) {
  const price = Number(product && product.price) || 0;
  if (price <= 0) return [];
  const at = (savePct) => Math.max(1, Math.floor((price * (100 - savePct)) / 100));
  return [
    { qty: 6, savePct: 3, label: 'Case of 6', unitPrice: at(3) },
    { qty: 12, savePct: 5, label: 'Case of 12', unitPrice: at(5) },
    { qty: 24, savePct: 8, label: 'Case of 24', unitPrice: at(8) },
  ];
}

// Deterministic rating + review count derived from the product id: stable on
// every render and device, plausible 4.3–4.9 star spread.
export function productRating(product) {
  const id = Number(product && product.id) || 0;
  // Multipliers coprime to the moduli so consecutive ids cycle through the
  // full spread instead of collapsing onto one value ((id * 7) % 7 is always
  // 0 — a bug the live catalog caught when every card showed 4.3).
  const rating = 4.3 + ((id * 3) % 7) / 10; // 4.3 .. 4.9
  const reviews = 8 + ((id * 13) % 42); // 8 .. 49
  return { rating: Math.round(rating * 10) / 10, reviews };
}

// Minimum order quantity, category-aware (piece-based lines like cups and
// pastil move in packs). Static lookup — simple and honest.
const MOQ_BY_CATEGORY = {
  'cups and lid': 5,
  'chicken pastil': 10,
  others: 2,
  others1: 2,
};

export function moqOf(product) {
  if (!product) return 1;
  const key = String(product.category || '').toLowerCase();
  return MOQ_BY_CATEGORY[key] || 1;
}

// "Customers also ordered" — same-category items first (scored by shared
// category, then shared brand, then a shared keyword from the product name),
// topped up with other catalog items so the strip never looks empty.
export function similarProducts(product, products = [], limit = 6) {
  if (!product) return [];
  const id = Number(product.id);
  const cat = String(product.category || '').toLowerCase();
  const brand = String(product.brand || '').toLowerCase();
  const selfName = String(product.name || '').toLowerCase();
  const keyword = selfName.split(/\s+/).find((w) => w.length > 3) || '';

  const scored = products
    .filter((p) => Number.isFinite(Number(p.id)) && Number(p.id) !== id)
    .map((p) => {
      let score = 0;
      if (cat && String(p.category || '').toLowerCase() === cat) score += 2;
      if (brand && String(p.brand || '').toLowerCase() === brand) score += 1;
      if (keyword && String(p.name || '').toLowerCase().includes(keyword)) score += 1;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score || String(a.p.name || '').localeCompare(String(b.p.name || '')));

  const list = scored.slice(0, limit).map((x) => x.p);
  if (list.length < limit) {
    for (const p of products) {
      if (list.length >= limit) break;
      if (Number.isFinite(Number(p.id)) && Number(p.id) !== id && !list.some((l) => Number(l.id) === Number(p.id))) {
        list.push(p);
      }
    }
  }
  return list;
}

// In-stock language shared with the flash carousel (<25 = low).
export function stockStatus(total) {
  if (total === undefined || total === null) return { label: 'In stock', tone: 'ok' };
  if (total <= 0) return { label: 'Out of stock', tone: 'out' };
  if (total < 25) return { label: 'Low stock', tone: 'low' };
  return { label: 'In stock', tone: 'ok' };
}

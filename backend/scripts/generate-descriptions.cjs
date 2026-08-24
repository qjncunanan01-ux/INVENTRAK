#!/usr/bin/env node
/**
 * Generate product descriptions for products missing them.
 * Uses product name, category, and size to create meaningful descriptions.
 */
const fs = require('fs');
const path = require('path');

const productsFile = path.join(__dirname, '..', 'data', 'products.json');
const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));

// Description templates by category
const categoryDescriptions = {
  'Da Vinci Syrup': 'premium flavored syrup',
  'Da Vinci Sauces': 'rich, flavorful sauce',
  'Da Vinci Powders': 'versatile powder mix',
  'Da Vinci BeverageMix': 'beverage mixing powder',
  'Da Vinci Mixologies': 'cocktail and mocktail mix',
  'Torani': 'classic flavored syrup',
  'Monin': 'artisan flavored syrup',
  'Top Creamery': 'creamy flavored syrup',
  'Dripp Flavours': 'premium flavored syrup',
  'Achievers': 'quality flavored syrup',
  'Coffee Beans': 'premium roasted coffee beans',
  'Full Cream Milk': 'creamy full cream milk',
  'Condense Milk': 'sweetened condensed milk',
  'Non Dairy Creamer': 'creamy non-dairy creamer',
  'Plant Based Milk': 'plant-based milk alternative',
  'Whip Cream': 'light and fluffy whipped cream',
  'Baking Chocolate': 'premium baking chocolate',
  'MATCHA POWDER': 'premium matcha powder',
  'Cups and Lid': 'disposable cup and lid set',
  'Chicken Pastil': 'ready-to-eat chicken pastil',
  'Spread_Jams_Biscuits': 'spreadable jam or biscuit',
  'Others': 'specialty ingredient',
  'Others1': 'specialty ingredient',
};

// Flavor descriptions
const flavorDescriptions = {
  'caramel': 'smooth, buttery caramel flavor',
  'vanilla': 'classic vanilla flavor',
  'chocolate': 'rich chocolate flavor',
  'hazelnut': 'nutty hazelnut flavor',
  'strawberry': 'sweet strawberry flavor',
  'blueberry': 'tangy blueberry flavor',
  'mango': 'tropical mango flavor',
  'peach': 'sweet peach flavor',
  'coconut': 'tropical coconut flavor',
  'matcha': 'earthy matcha green tea flavor',
  'butter': 'rich butter flavor',
  'butterscotch': 'sweet butterscotch flavor',
  'rum': 'warm rum flavor',
  'almond': 'nutty almond flavor',
  'pistachio': 'nutty pistachio flavor',
  'tiramisu': 'classic tiramisu dessert flavor',
  'mocha': 'rich mocha coffee flavor',
  'honey': 'natural honey sweetness',
  'lemon': 'bright citrus lemon flavor',
  'lime': 'zesty lime flavor',
  'orange': 'fresh orange citrus flavor',
  'mint': 'cool minty flavor',
  'cinnamon': 'warm cinnamon spice',
  'toffee': 'sweet toffee flavor',
  'white chocolate': 'creamy white chocolate flavor',
  'dark chocolate': 'intense dark chocolate flavor',
  'milk chocolate': 'smooth milk chocolate flavor',
  'dulce de leche': 'creamy caramelized milk flavor',
  'salted caramel': 'sweet and salty caramel flavor',
  'espresso': 'bold espresso coffee flavor',
  'classic': 'classic signature flavor',
  'osmanthus': 'floral osmanthus flavor',
  'passion fruit': 'tropical passion fruit flavor',
  'yuzu': 'bright yuzu citrus flavor',
  'lychee': 'sweet lychee flavor',
  'wintermelon': 'refreshing wintermelon flavor',
  'ube': 'rich ube purple yam flavor',
  'mocha': 'rich mocha coffee flavor',
  'honey': 'natural honey sweetness',
  'brown sugar': 'rich brown sugar sweetness',
};

function generateDescription(product) {
  const name = (product.name || product['Product Name'] || '').toLowerCase();
  const category = product.category || product.Category || '';
  const size = product.size || product.Size || '';

  // Extract flavor from name
  let flavor = '';
  for (const [key, desc] of Object.entries(flavorDescriptions)) {
    if (name.includes(key)) {
      flavor = desc;
      break;
    }
  }

  // Get category description
  let catDesc = categoryDescriptions[category] || 'quality product';

  // Build description
  let desc = '';

  if (name.includes('syrup') || name.includes('sauce')) {
    desc = `Premium ${flavor || 'flavored'} ${name.includes('sauce') ? 'sauce' : 'syrup'}. `;
    desc += `Perfect for coffee, beverages, desserts, and creative recipes. `;
    if (size) desc += `Comes in a ${size} bottle.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('powder') || name.includes('matcha')) {
    desc = `High-quality ${flavor || ''} powder mix. `;
    desc += `Ideal for creating delicious drinks and desserts. `;
    if (size) desc += `Net weight: ${size}.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('milk') || name.includes('creamer')) {
    desc = `Creamy ${category.toLowerCase()} perfect for coffee and beverages. `;
    desc += `Adds rich, smooth texture to any drink. `;
    if (size) desc += `Comes in a ${size} pack.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('chocolate')) {
    desc = `Premium ${flavor || 'chocolate'} for baking and beverages. `;
    desc += `Delivers rich, authentic chocolate flavor. `;
    if (size) desc += `Net weight: ${size}.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('whip') || name.includes('cream')) {
    desc = `Light and fluffy whipped cream topping. `;
    desc += `Perfect for desserts, coffee, and specialty drinks. `;
    if (size) desc += `Comes in a ${size} can.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('cup') || name.includes('lid')) {
    desc = `Disposable ${name.includes('lid') ? 'lids' : 'cups'} for beverages. `;
    desc += `Perfect for serving hot and cold drinks. `;
    if (size) desc += `Pack size: ${size}.`;
    else desc += `Available in various quantities.`;
  } else if (name.includes('coffee') || name.includes('bean')) {
    desc = `Premium roasted coffee beans. `;
    desc += `Rich aroma and full-bodied flavor for the perfect cup. `;
    if (size) desc += `Net weight: ${size}.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('tea')) {
    desc = `Premium quality tea leaves. `;
    desc += `Smooth, aromatic flavor for hot or iced beverages. `;
    if (size) desc += `Net weight: ${size}.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('pastil')) {
    desc = `Ready-to-eat ${flavor || 'chicken pastil'}. `;
    desc += `Traditional Filipino delicacy, perfect for a quick meal. `;
    if (size) desc += `Pack size: ${size}.`;
    else desc += `Available in various sizes.`;
  } else if (name.includes('spread') || name.includes('jam')) {
    desc = `Delicious spreadable ${flavor || 'fruit'} spread. `;
    desc += `Perfect for bread, pastries, and desserts. `;
    if (size) desc += `Jar size: ${size}.`;
    else desc += `Available in various sizes.`;
  } else {
    // Generic description
    desc = `${catDesc.charAt(0).toUpperCase() + catDesc.slice(1)}. `;
    if (flavor) desc += `Features ${flavor}. `;
    desc += `High-quality ingredient for professional and home use. `;
    if (size) desc += `Size: ${size}.`;
    else desc += `Available in various sizes.`;
  }

  return desc;
}

// Process products
let updated = 0;
let skipped = 0;

products.forEach((product, idx) => {
  const desc = product.description || product.Description || '';
  if (desc.trim().length > 20) {
    skipped++;
    return; // Already has description
  }

  const newDesc = generateDescription(product);
  if (product.description !== undefined) {
    product.description = newDesc;
  } else if (product.Description !== undefined) {
    product.Description = newDesc;
  } else {
    product.description = newDesc;
  }
  updated++;
});

// Write back
fs.writeFileSync(productsFile, JSON.stringify(products, null, 2), 'utf8');

console.log(`Updated ${updated} products with new descriptions`);
console.log(`Skipped ${skipped} products (already had descriptions)`);
console.log(`Total: ${products.length} products`);

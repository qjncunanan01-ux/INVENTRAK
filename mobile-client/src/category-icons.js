// Category -> MaterialCommunityIcons name map, shared by the Home category
// chips, the Categories grid, and any catalog surface that wants a real icon
// instead of plain text (Shopee/Lazada-style browsing).
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export const CATEGORY_ICONS = {
  Achievers: 'trophy-outline',
  'Baking Chocolate': 'cupcake',
  'Chicken Pastil': 'food-drumstick-outline',
  'Coffee Beans': 'coffee-outline',
  'Condense Milk': 'cup-water',
  'Cups and Lid': 'cup-outline',
  'Da Vinci BeverageMix': 'glass-cocktail',
  'Da Vinci Mixologies': 'glass-mug-variant',
  'Da Vinci Powders': 'shaker-outline',
  'Da Vinci Sauces': 'silverware-fork-knife',
  'Da Vinci Syrup': 'bottle-tonic-outline',
  'Dripp Flavours': 'bottle-tonic',
  'Full Cream Milk': 'cup-water',
  'MATCHA POWDER': 'tea-outline',
  Monin: 'bottle-tonic-plus-outline',
  'Non Dairy Creamer': 'cup-outline',
  Others: 'package-variant-closed',
  Others1: 'package-variant',
  'Plant Based Milk': 'sprout-outline',
  Spread_Jams_Biscuits: 'cookie-outline',
  'Top Creamery': 'ice-cream',
  Torani: 'bottle-tonic-skull-outline',
  'Whip Cream': 'creation',
  // Legacy category names from the original 8-product catalog.
  Beans: 'coffee',
  Cups: 'cup-outline',
  Matcha: 'tea',
  Powders: 'shaker',
  Milk: 'cup-water',
  Sauces: 'silverware-fork-knife',
  Syrups: 'bottle-tonic-outline',
};

// Safe lookup: unknown categories get a neutral inventory icon so no surface
// ever renders a blank tile.
export function categoryIcon(category) {
  return CATEGORY_ICONS[category] || 'package-variant-closed';
}

// Render helper: a category tile icon (used by the Categories grid).
export function CategoryGlyph({ category, size = 30, color, style }) {
  return (
    <MaterialCommunityIcons name={categoryIcon(category)} size={size} color={color} style={style} />
  );
}

export default CATEGORY_ICONS;

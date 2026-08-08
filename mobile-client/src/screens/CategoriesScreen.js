import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { listAllProducts, listCategories } from '../api';
import { useThemeColors } from '../theme-context';

// Simple per-category glyphs so the grid reads like a real category page.
// Covers the supplier library's 23 categories; unknown ones get a generic tile.
const CATEGORY_GLYPHS = {
  Achievers: '🍬',
  'Baking Chocolate': '🍫',
  'Chicken Pastil': '🍗',
  'Coffee Beans': '☕',
  'Condense Milk': '🥛',
  'Cups and Lid': '🥤',
  'Da Vinci BeverageMix': '🧋',
  'Da Vinci Mixologies': '🍹',
  'Da Vinci Powders': '🧂',
  'Da Vinci Sauces': '🍯',
  'Da Vinci Syrup': '🍯',
  'Dripp Flavours': '🍯',
  'Full Cream Milk': '🥛',
  'MATCHA POWDER': '🍵',
  Monin: '🍯',
  'Non Dairy Creamer': '🥛',
  Others: '📦',
  Others1: '📦',
  'Plant Based Milk': '🥛',
  Spread_Jams_Biscuits: '🍪',
  'Top Creamery': '🧁',
  Torani: '🍯',
  'Whip Cream': '🍦',
  // Legacy category names from the original 8-product catalog.
  Beans: '☕',
  Cups: '🥤',
  Matcha: '🍵',
  Powders: '🧂',
  Milk: '🥛',
  Sauces: '🍯',
  Syrups: '🍯',
};

export default function CategoriesScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [catData, products] = await Promise.all([
        listCategories(),
        listAllProducts(),
      ]);
      const cats = Array.isArray(catData) ? catData : [];
      const c = {};
      cats.forEach((name) => { c[name] = 0; });
      products.forEach((p) => {
        if (p.category && c[p.category] !== undefined) c[p.category] += 1;
      });
      setCategories(cats);
      setCounts(c);
    } catch (err) {
      // Grid still renders with whatever loaded
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const openCategory = (name) => {
    navigation.navigate('Products', {
      initialCategory: name,
      initialSearch: '',
    });
  };

  const tiles = useMemo(() => {
    // Put categories with products first, alphabetically within.
    return [...categories].sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b));
  }, [categories, counts]);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Browse by Category</Text>
      <Text style={styles.subtitle}>{tiles.length} categories</Text>

      <FlatList
        data={tiles}
        numColumns={2}
        keyExtractor={(item) => item}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        columnWrapperStyle={styles.rowWrap}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.tile} onPress={() => openCategory(item)}>
            <Text style={styles.tileGlyph}>{CATEGORY_GLYPHS[item] || '▤'}</Text>
            <Text style={styles.tileName} numberOfLines={1}>{item}</Text>
            <Text style={styles.tileCount}>{counts[item] || 0} items</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No categories available.</Text>}
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  rowWrap: { justifyContent: 'space-between' },
  listContent: { paddingBottom: 24 },
  tile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  tileGlyph: { fontSize: 30, color: colors.brandPrimary, marginBottom: 8 },
  tileName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  tileCount: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  empty: { marginTop: 24, textAlign: 'center', color: colors.textSecondary },
});

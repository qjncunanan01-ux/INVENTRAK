import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { imageUrl, listAllProducts } from '../api';
import BackButton from '../BackButton';
import { useCart } from '../cart-context';
import { useLoginGate } from '../login-gate';
import { useThemeColors } from '../theme-context';

export default function SearchScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { addItem } = useCart();
  const { requireLogin, gateModal } = useLoginGate(navigation);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    // Autofocus the search field, Shopee-style.
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      // Page past the 100-row clamp so searching finds ANY of the 192
      // products, not just the first page.
      const items = await listAllProducts();
      setProducts(items);
    } catch (err) {
      // Keep the screen usable with no data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) =>
      [p.name, p.category, p.brand].filter(Boolean).some((s) => s.toLowerCase().includes(q))
    );
  }, [products, query]);

  const openProduct = (id) => {
    navigation.navigate('Products', { focusId: id });
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        {/* Labeled back pill (dark on the brand header) — thumb-friendly and
            clearly says where it goes, unlike a bare chevron. */}
        <BackButton navigation={navigation} label="Products" dark />
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={18} color={colors.textSecondary} style={styles.searchGlyph} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Search supplies, brands, categories..."
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : query.trim() ? (
        <FlatList
          data={results}
          numColumns={2}
          keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
          columnWrapperStyle={styles.rowWrap}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openProduct(item.id)}>
              <View style={styles.cardTop}>
                {item.image ? (
                  <Image source={{ uri: imageUrl(item.image) }} style={styles.cardImage} resizeMode="cover" />
                ) : null}
                {/* Quick-add (+), Shopee-style: adds without leaving results.
                    Guests get the login gate instead. */}
                <TouchableOpacity
                  style={styles.quickAdd}
                  onPress={() => requireLogin(() => addItem(item, 1))}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.quickAddText}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.cardMeta} numberOfLines={1}>{item.category}</Text>
              <Text style={styles.cardPrice}>P{item.price}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No results for "{query.trim()}".</Text>
          }
        />          ) : (
        <View style={styles.hintWrap}>
          <MaterialCommunityIcons name="magnify" size={44} color={colors.brandSecondary} style={styles.hintGlyph} />
          <Text style={styles.hint}>Search by product name, category, or brand.</Text>
          <Text style={styles.hintSub}>Try "milk", "sauce", or "beans".</Text>
        </View>
      )}
      {gateModal}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: {
    backgroundColor: colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 56,
    paddingBottom: 12,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 14,
    // Room for the labeled back pill on the left.
    marginLeft: 118,
  },
  searchGlyph: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 15, color: colors.textPrimary },
  clearText: { fontSize: 16, color: colors.textSecondary, fontWeight: '700', paddingLeft: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  rowWrap: { justifyContent: 'space-between' },
  listContent: { padding: 16 },
  card: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  cardTop: { minHeight: 42 },
  cardImage: { width: '100%', height: 90, borderRadius: 8, marginBottom: 8, backgroundColor: colors.background },
  cardName: { fontWeight: '700', fontSize: 14, color: colors.textPrimary, minHeight: 36 },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary, marginTop: 8 },
  quickAdd: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  quickAddText: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 24 },
  empty: { marginTop: 32, textAlign: 'center', color: colors.textSecondary },
  hintWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hintGlyph: { marginBottom: 12 },
  hint: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  hintSub: { fontSize: 13, color: colors.textSecondary, marginTop: 6, opacity: 0.8 },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { listProducts } from '../api';
import { colors } from '../theme';

export default function SearchScreen({ navigation }) {
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
      const data = await listProducts({ limit: 100 });
      setProducts(data.data || (Array.isArray(data) ? data : []));
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
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Text style={styles.searchGlyph}>⌕</Text>
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
          keyExtractor={(item) => item.id?.toString()}
          columnWrapperStyle={styles.rowWrap}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openProduct(item.id)}>
              <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.cardMeta} numberOfLines={1}>{item.category}</Text>
              <Text style={styles.cardPrice}>P{item.price}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No results for "{query.trim()}".</Text>
          }
        />
      ) : (
        <View style={styles.hintWrap}>
          <Text style={styles.hintGlyph}>⌕</Text>
          <Text style={styles.hint}>Search by product name, category, or brand.</Text>
          <Text style={styles.hintSub}>Try "milk", "sauce", or "beans".</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: {
    backgroundColor: colors.brandPrimary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: { paddingRight: 8, paddingLeft: 4, alignSelf: 'stretch', justifyContent: 'center' },
  backText: { color: '#fff', fontSize: 34, fontWeight: '300', lineHeight: 36 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 14,
  },
  searchGlyph: { fontSize: 16, color: colors.textSecondary, marginRight: 8, fontWeight: '700' },
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
  cardName: { fontWeight: '700', fontSize: 14, color: colors.textPrimary, minHeight: 36 },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary, marginTop: 8 },
  empty: { marginTop: 32, textAlign: 'center', color: colors.textSecondary },
  hintWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hintGlyph: { fontSize: 44, color: colors.brandSecondary, fontWeight: '700', marginBottom: 12 },
  hint: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  hintSub: { fontSize: 13, color: colors.textSecondary, marginTop: 6, opacity: 0.8 },
});

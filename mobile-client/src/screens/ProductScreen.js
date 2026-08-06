import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { listProducts } from '../api';
import { colors } from '../theme';

export default function ProductScreen({ route, navigation }) {
  const initialSearch = route.params?.initialSearch || '';
  const initialCategory = route.params?.initialCategory || '';
  const focusId = route.params?.focusId;

  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState(initialSearch);
  const [category, setCategory] = useState(initialCategory);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);

  const fetchProducts = useCallback(async () => {
    try {
      const data = await listProducts({ limit: 100 });
      setProducts(data.data || (Array.isArray(data) ? data : []));
    } catch (err) {
      Alert.alert('Error', 'Failed to load products. Please pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // If Home deep-linked to a specific product, show it after load.
  useEffect(() => {
    if (focusId && products.length > 0 && !selected) {
      const found = products.find((p) => Number(p.id) === Number(focusId));
      if (found) setSelected(found);
    }
  }, [focusId, products, selected]);

  // Sync search/category when Home navigates here with new params while the
  // screen is already mounted (useState initializers only run on first mount).
  useEffect(() => {
    if (route.params?.initialSearch !== undefined) setFilter(route.params.initialSearch);
    if (route.params?.initialCategory !== undefined) setCategory(route.params.initialCategory);
  }, [route.params?.initialSearch, route.params?.initialCategory]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts();
  }, [fetchProducts]);

  const categories = useMemo(
    () => ['', ...new Set(products.map((p) => p.category).filter(Boolean))],
    [products]
  );

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const q = filter.toLowerCase().trim();
        const matchQ = !q || (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
        const matchC = !category || p.category === category;
        return matchQ && matchC;
      }),
    [products, filter, category]
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  // ---- PDP: sticky "Send Inquiry" bar (Shopee/Lazada pattern) ----
  if (selected) {
    return (
      <View style={styles.container}>
        <View style={styles.pdp}>
          <TouchableOpacity onPress={() => setSelected(null)} style={styles.backLink}>
            <Text style={styles.backText}>{'< Back to products'}</Text>
          </TouchableOpacity>

          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>{selected.name}</Text>
            <Text style={styles.detailCategory}>{selected.category}</Text>
            <Text style={styles.detailPrice}>P{selected.price}</Text>

            <View style={styles.detailRow}><Text style={styles.detailLabel}>Brand:</Text><Text>{selected.brand || '-'}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Size:</Text><Text>{selected.size || '-'}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Unit:</Text><Text>{selected.unit || 'pcs'}</Text></View>
            {selected.description ? (
              <Text style={styles.detailDesc}>{selected.description}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.stickyBar}>
          <TouchableOpacity
            style={styles.stickyBtn}
            onPress={() =>
              navigation.navigate('OrdersTab', {
                screen: 'OrderInquiry',
                params: { preselectId: selected.id },
              })
            }
          >
            <Text style={styles.stickyBtnText}>Send Order Inquiry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- PLP: 2-column grid + search + category chips ----
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Search products by name..."
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
      />

      <FlatList
        horizontal
        data={categories}
        keyExtractor={(c) => c || 'all'}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.chip, category === item && styles.chipActive]}
            onPress={() => setCategory(item)}
          >
            <Text style={[styles.chipText, category === item && styles.chipTextActive]}>
              {item || 'All'}
            </Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={filtered}
        numColumns={2}
        keyExtractor={(item) => item.id?.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        columnWrapperStyle={styles.rowWrap}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => setSelected(item)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
            </View>
            <Text style={styles.cardMeta} numberOfLines={1}>{item.category}</Text>
            <Text style={styles.cardPrice}>P{item.price}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No products found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  input: { backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginBottom: 10, color: colors.textPrimary, fontSize: 15 },
  chipRow: { paddingBottom: 10 },
  chip: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  rowWrap: { justifyContent: 'space-between' },
  listContent: { paddingBottom: 24 },
  card: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTop: { minHeight: 42 },
  cardName: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
  cardMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  cardPrice: { color: colors.brandPrimary, fontWeight: '800', fontSize: 15, marginTop: 8 },
  empty: { marginTop: 24, textAlign: 'center', color: colors.textSecondary },
  pdp: { flex: 1 },
  backLink: { paddingVertical: 10 },
  backText: { color: colors.info, fontSize: 15, fontWeight: '600' },
  detailCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 20 },
  detailTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  detailCategory: { color: colors.textSecondary, marginTop: 4 },
  detailPrice: { fontSize: 24, fontWeight: '800', color: colors.brandPrimary, marginTop: 10, marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  detailLabel: { color: colors.textSecondary, fontWeight: '500' },
  detailDesc: { marginTop: 12, color: colors.textSecondary, lineHeight: 20 },
  stickyBar: {
    backgroundColor: '#fff',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  stickyBtn: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  stickyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

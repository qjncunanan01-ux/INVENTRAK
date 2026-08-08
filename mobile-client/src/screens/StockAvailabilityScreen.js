import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getInventory, imageUrl } from '../api';
import EmptyState from '../EmptyState';
import { useThemeColors } from '../theme-context';

// Multi-Location Inventory Management Module (reviewer requirement): customers
// can see available supply stock broken down per location (store, warehouse,
// etc.) before ordering — same data the admin dashboard tracks.
export default function StockAvailabilityScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      setData({ locations: parsed.locations || [], items: parsed.items || [] });
    } catch (err) {
      // Guest-safe: silently render empty
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

  const locations = (data.locations || []).map((l) => (typeof l === 'object' ? l.name : l));
  // Live search: filter products by name or category.
  const items = (data.items || []).filter((i) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (i.total > 0) &&
      ((i.product?.name || '').toLowerCase().includes(q) ||
       (i.product?.category || '').toLowerCase().includes(q));
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Available Supplies</Text>
        <Text style={styles.subtitle}>Stock levels across all {locations.length} location(s)</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.product?.id?.toString() || item.product?.name}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          items.length > 0 ? (
            <View style={styles.locRow}>
              <Text style={[styles.locCell, styles.locName]}>Product</Text>
              {locations.map((loc) => (
                <Text key={loc} style={[styles.locCell, styles.locQty]} numberOfLines={1}>{loc}</Text>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={[styles.cell, styles.productCell]}>
              {item.product?.image ? (
                <Image source={{ uri: imageUrl(item.product.image) }} style={styles.thumb} resizeMode="cover" />
              ) : null}
              <Text style={styles.productName} numberOfLines={2}>{item.product?.name}</Text>
            </View>
            {locations.map((loc) => (
              <Text key={loc} style={[styles.cell, styles.qty]}>
                {item.locations[loc] ?? 0}
              </Text>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            glyph="🏬"
            title="No stock data yet"
            sub="Nothing matches your search or the stock feed is still warming up — pull down to refresh."
          />
        }
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  searchInput: {
    marginTop: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
  },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  locRow: { flexDirection: 'row', backgroundColor: colors.brandPrimary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10, marginBottom: 8 },
  locName: { color: '#fff' },
  locQty: { color: '#fff', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10, marginBottom: 6 },
  cell: { flex: 1, fontSize: 13 },
  productCell: { flex: 2, flexDirection: 'row', alignItems: 'center' },
  productName: { color: colors.textPrimary, fontWeight: '600', flex: 1 },
  thumb: { width: 32, height: 32, borderRadius: 6, marginRight: 8, backgroundColor: colors.background },
  qty: { color: colors.textPrimary, textAlign: 'center', fontWeight: '700' },
});

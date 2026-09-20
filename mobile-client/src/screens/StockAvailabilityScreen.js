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
export default function StockAvailabilityScreen({ route }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  // Optional QR-scan scope: when the user scans a location tag, this screen
  // opens focused on that one storage area (single-column view).
  const scopedLocation = route?.params?.location || '';

  const fetchData = useCallback(async() => {
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

  const allLocations = (data.locations || []).map((l) => (typeof l === 'object' ? l.name : l));
  // When opened from a scanned location tag, show only that storage area.
  const locations = scopedLocation && allLocations.includes(scopedLocation)
    ? [scopedLocation]
    : allLocations;
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
        <Text style={styles.subtitle}>
          {scopedLocation
            ? `Stock levels at ${scopedLocation} (scanned tag)`
            : `Stock levels across all ${locations.length} location(s)`}
        </Text>
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
  cell: { flex: 1, fontSize: 13 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  container: { backgroundColor: colors.background, flex: 1 },
  header: { paddingBottom: 8, paddingHorizontal: 16, paddingTop: 16 },
  list: { paddingBottom: 24, paddingHorizontal: 16 },
  locName: { color: '#fff' },
  locQty: { color: '#fff', textAlign: 'center' },
  locRow: { backgroundColor: colors.brandPrimary, borderRadius: 10, flexDirection: 'row', marginBottom: 8, paddingHorizontal: 10, paddingVertical: 10 },
  productCell: { alignItems: 'center', flex: 2, flexDirection: 'row' },
  productName: { color: colors.textPrimary, flex: 1, fontWeight: '600' },
  qty: { color: colors.textPrimary, fontWeight: '700', textAlign: 'center' },
  row: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, flexDirection: 'row', marginBottom: 6, paddingHorizontal: 10, paddingVertical: 10 },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  thumb: { backgroundColor: colors.background, borderRadius: 6, height: 32, marginRight: 8, width: 32 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
});

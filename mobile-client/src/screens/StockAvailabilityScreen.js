import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getInventory, imageUrl } from '../api';
import { colors } from '../theme';

// Multi-Location Inventory Management Module (reviewer requirement): customers
// can see available supply stock broken down per location (store, warehouse,
// etc.) before ordering — same data the admin dashboard tracks.
export default function StockAvailabilityScreen() {
  const [data, setData] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
  const items = (data.items || []).filter((i) => i.total > 0);

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
        ListEmptyComponent={<Text style={styles.empty}>No stock availability data yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
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
  empty: { marginTop: 24, textAlign: 'center', color: colors.textSecondary },
});

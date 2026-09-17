import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getInventory } from '../api';
import CountCard from '../components/CountCard';
import { useThemeColors } from '../theme-context';

// COUNT — the no-camera module. Search the live inventory, tap a product,
// verify & record the physical count through the shared CountCard (the same
// form the scan modules use, including optional best-before capture).
export default function CountScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // inventory item

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      setData({ locations: parsed.locations || [], items: parsed.items || [] });
    } catch {
      setError('Could not load inventory. Check the connection and pull to refresh.');
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

  // In-stock items only on the browse list (counting a zero-everywhere
  // product is possible from the scan modules via a tag; here search would
  // drown in 200 empty rows).
  const items = (data.items || []).filter((i) => {
    if (i.total <= 0) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (i.product?.name || '').toLowerCase().includes(q) ||
      (i.product?.category || '').toLowerCase().includes(q);
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
        <Text style={styles.title}>Physical Count</Text>
        <Text style={styles.subtitle}>
          {data.items.length} products · {data.locations.length} storage area(s)
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.product?.id ?? item.product?.name)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />
        }
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setSelected(item)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{item.product?.name}</Text>
              <Text style={styles.rowMeta}>
                {Object.entries(item.locations || {})
                  .filter(([, v]) => Number(v) > 0)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || 'No stock recorded'}
              </Text>
            </View>
            <Text style={styles.rowTotal}>{item.total}</Text>
            <Text style={styles.rowCta}>Count ›</Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          selected ? (
            <View style={{ marginTop: 8 }}>
              <View style={styles.selHead}>
                <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10}>
                  <Text style={styles.back}>‹ Close form</Text>
                </TouchableOpacity>
              </View>
              <CountCard
                focus={{
                  id: selected.product?.id,
                  name: selected.product?.name,
                  stock: { locations: selected.locations || {} },
                }}
                onClear={() => setSelected(null)}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No products match. Pull down to refresh.</Text>
        }
      />
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 6,
    },
    rowName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    rowMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    rowTotal: {
      color: colors.textPrimary,
      fontWeight: '800',
      fontSize: 15,
      marginLeft: 8,
      minWidth: 34,
      textAlign: 'right',
    },
    rowCta: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13, marginLeft: 10 },
    empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 13 },
    err: { color: colors.error, fontSize: 12, paddingHorizontal: 16, marginBottom: 6, lineHeight: 17 },
    selHead: { paddingHorizontal: 0, marginBottom: 6 },
    back: { color: colors.brandPrimary, fontWeight: '800', fontSize: 14 },
  });

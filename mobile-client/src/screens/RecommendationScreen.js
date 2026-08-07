import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getOptimizationAbc, imageUrl, listAllProducts } from '../api';
import { colors } from '../theme';

// Recommendation + Costing modules (reviewer requirement): the recommended
// supply bundle is the top A-classified products; the estimated costing shows
// the total for one unit of each, and "Order this bundle" prefills the
// checkout inquiry with every item at qty 1.
export default function RecommendationScreen({ navigation }) {
  const [recommendations, setRecommendations] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const [abcData, prodItems] = await Promise.all([getOptimizationAbc(), listAllProducts()]);
      const abc = abcData.data ? abcData.data : (Array.isArray(abcData) ? abcData : []);
      const prods = prodItems;
      setRecommendations(abc);
      setProducts(prods);
    } catch (err) {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  // Recommended bundle = top 3 A-classified products (with catalog prices).
  const bundle = recommendations
    .filter((r) => r.classification === 'A')
    .slice(0, 3)
    .map((r) => {
      const p = products.find((pr) => Number(pr.id) === Number(r.id)) || {};
      return { id: r.id, name: r.name, price: Number(p.price) || 0, image: p.image || null };
    });
  const bundleCost = bundle.reduce((sum, b) => sum + b.price, 0);

  const orderBundle = () => {
    if (bundle.length === 0) return;
    navigation.navigate('OrdersTab', {
      screen: 'OrderInquiry',
      params: { bundleIds: bundle.map((b) => b.id) },
    });
  };

  const getBadge = (classification) => {
    if (classification === 'A') return { bg: '#d32f2f', label: 'High Priority' };
    if (classification === 'B') return { bg: '#f9a825', label: 'Medium' };
    return { bg: '#2e7d32', label: 'Low' };
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Suggested Supplies</Text>
      <Text style={styles.subtitle}>ABC-classified top recommendations with estimated costing</Text>

      <FlatList
        data={recommendations}
        keyExtractor={(item) => item.id?.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          bundle.length > 0 ? (
            <View style={styles.bundleCard}>
              <Text style={styles.bundleTitle}>🛒 Recommended supply bundle</Text>
              {bundle.map((b) => (
                <View key={b.id} style={styles.bundleItem}>
                  {b.image ? (
                    <Image source={{ uri: imageUrl(b.image) }} style={styles.bundleThumb} resizeMode="cover" />
                  ) : null}
                  <Text style={styles.bundleName} numberOfLines={1}>{b.name}</Text>
                  <Text style={styles.bundlePrice}>P{b.price.toFixed(2)}</Text>
                </View>
              ))}
              <View style={styles.bundleTotal}>
                <Text style={styles.bundleTotalLabel}>Estimated cost (1 each)</Text>
                <Text style={styles.bundleTotalValue}>P{bundleCost.toFixed(2)}</Text>
              </View>
              <TouchableOpacity style={styles.orderBtn} onPress={orderBundle}>
                <Text style={styles.orderBtnText}>Order this bundle</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const badge = getBadge(item.classification);
          const p = products.find((pr) => Number(pr.id) === Number(item.id)) || {};
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.productName}>{item.name}</Text>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.badgeText}>{item.classification}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                Value: {item.value} | {badge.label}
                {p.price ? ` | P${p.price}` : ''}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No recommendations available.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4, color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  list: { paddingBottom: 24 },
  bundleCard: { backgroundColor: '#fff8e1', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#f0c36d' },
  bundleTitle: { fontWeight: '700', fontSize: 15, color: colors.textPrimary, marginBottom: 10 },
  bundleItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bundleThumb: { width: 32, height: 32, borderRadius: 6, marginRight: 8, backgroundColor: colors.background },
  bundleName: { flex: 1, fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  bundlePrice: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  bundleTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)' },
  bundleTotalLabel: { color: colors.textSecondary, fontSize: 13 },
  bundleTotalValue: { fontWeight: '800', fontSize: 16, color: colors.brandPrimary },
  orderBtn: { marginTop: 10, backgroundColor: colors.brandPrimary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  orderBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  productName: { fontWeight: '700', fontSize: 16, color: colors.textPrimary, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
});

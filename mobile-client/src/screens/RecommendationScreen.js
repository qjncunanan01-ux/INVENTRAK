import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getInventory, getOptimizationAbc, imageUrl, listAllProducts } from '../api';
import { useCart } from '../cart-context';
import { useLoginGate } from '../login-gate';
import { buildFlashPicks, dealPricing, stockMapFromInventory } from '../flash-sale';
import FlashCarousel from '../FlashCarousel';
import FlashSaleHeader from '../FlashSaleHeader';
import { showToast } from '../toast';
import { useThemeColors } from '../theme-context';

// Recommendation + Costing modules (reviewer requirement): the recommended
// supply bundle is the top A-classified products; the estimated costing shows
// the total for one unit of each, and "Order this bundle" prefills the
// checkout inquiry with every item at qty 1.
export default function RecommendationScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [recommendations, setRecommendations] = useState([]);
  const [products, setProducts] = useState([]);
  // The 🔥 24hr Flash Deal section — today's rotated picks, computed with the
  // SAME helper and inputs as the Home carousel so both always match.
  const [flashPicks, setFlashPicks] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { addItem } = useCart();
  // Ordering a bundle adds to the cart — member-only, gated for guests.
  const bundleGate = useLoginGate(navigation, {
    title: 'Log in to order a bundle',
    body: 'Recommended bundles are added straight to your cart, which is a member feature. Create a free account or log in to order this bundle.',
  });
  // Quick-add on the flash-deal cards — same gate as everywhere else.
  const quickAddGate = useLoginGate(navigation);

  // useCallback so the FlashSaleHeader's day-rollover effect sees a stable
  // onRefresh (matches Home) and the flash section degrades like Home when
  // the ABC call fails: .catch(() => []) lets buildFlashPicks top up from
  // the photo pool instead of showing an empty carousel.
  const fetchData = useCallback(async () => {
    try {
      const [abcData, prodItems, inv] = await Promise.all([
        getOptimizationAbc().catch(() => []),
        listAllProducts(),
        getInventory().catch(() => null),
      ]);
      const abc = abcData.data ? abcData.data : (Array.isArray(abcData) ? abcData : []);
      const prods = prodItems;
      const stock = stockMapFromInventory(inv);
      setRecommendations(abc);
      setProducts(prods);
      setFlashPicks(buildFlashPicks(abc, prods, stock));
      setStockMap(stock);
    } catch (err) {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    bundleGate.requireLogin(() =>
      navigation.navigate('OrdersTab', {
        screen: 'OrderInquiry',
        params: { bundleIds: bundle.map((b) => b.id) },
      })
    );
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
      <Text style={styles.subtitle}>All top picks, ranked by annual value (A first) — tap one for details</Text>

      <FlatList
        data={recommendations}
        keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            {/* 🔥 24hr Flash Deal — today's rotated picks with the same live
                countdown as Home, so the ranked list and the Home carousel
                feature the exact same products today. */}
            <FlashSaleHeader
              title="🔥 24hr Flash Deal"
              subtitle="Today's rotated top-value picks — new deals every midnight"
              onRefresh={fetchData}
            />
            <FlashCarousel
              items={flashPicks}
              stockMap={stockMap}
              onPressItem={(item) => navigation.push('Products', { focusId: item.id })}
              onAdd={(item) =>
                quickAddGate.requireLogin(() => {
                  // Snapshot the day's deal price so the cart matches the card.
                  const d = dealPricing(item);
                  addItem(item, 1, d ? d.deal : undefined, d ? d.original : undefined);
                  // Nested stack: hop up to the tab navigator to reach Cart.
                  showToast('Added to cart', {
                    actionLabel: 'View',
                    onAction: () => navigation.getParent()?.navigate('CartTab'),
                  });
                })
              }
            />
            <Text style={styles.rankedTitle}>★ Top-ranked recommendations</Text>
            {bundle.length > 0 ? (
              <View style={styles.bundleCard}>
                <Text style={styles.bundleTitle}>🛒 Recommended supply bundle</Text>
                {bundle.map((b, idx) => (
                  <View key={b.id ?? b.name ?? idx} style={styles.bundleItem}>
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
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const badge = getBadge(item.classification);
          const p = products.find((pr) => Number(pr.id) === Number(item.id)) || {};
          return (
            // Whole row is tappable and opens the product detail (same
            // focusId deep-link the Home carousel uses), so the ranked list
            // and the catalog stay connected. push() (not navigate) so a
            // fresh Products screen stacks on top and back always returns
            // to the ranked list — navigate() could pop to the catalog grid
            // instead, since Products is this stack's initial route.
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => navigation.push('Products', { focusId: item.id })}
            >
              {p.image ? (
                <Image source={{ uri: imageUrl(p.image) }} style={styles.cardThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.cardThumb, styles.cardThumbPlaceholder]} />
              )}
              <View style={styles.rankBadge} accessibilityLabel={`Rank ${index + 1}`}>
                <Text style={styles.rankText}>#{index + 1}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardHeader}>
                  <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={styles.badgeText}>{item.classification}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  Value: {item.value} | {badge.label}
                  {p.price ? ` | P${p.price}` : ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No recommendations available.</Text>}
      />
      {bundleGate.gateModal}
      {quickAddGate.gateModal}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4, color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  list: { paddingBottom: 24 },
  rankedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: 16,
    marginTop: 6,
    marginBottom: 10,
  },
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
  // position: relative so the absolutely-positioned rank badge anchors to
  // the card (works on native and react-native-web alike).
  card: { position: 'relative', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, padding: 12, borderRadius: 12, marginBottom: 10 },
  cardThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.background },
  cardThumbPlaceholder: { backgroundColor: '#e3eeda' },
  rankBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    zIndex: 1,
    backgroundColor: colors.brandPrimary,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  rankText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  cardBody: { flex: 1, marginLeft: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  productName: { fontWeight: '700', fontSize: 15, color: colors.textPrimary, flex: 1 },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 8 },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
});

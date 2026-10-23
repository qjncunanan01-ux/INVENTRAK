import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getInventory, getOptimizationAbc, imageUrl, listAllProducts, useSessionUsername } from '../../api';
import { company } from '../../theme';
import { useThemeColors } from '../../theme-context';
import { productTitle, stockStatus, stockMapFromInventory } from '../../product-enrichment';

const HOME_CATEGORY_GROUPS = [
  { label: 'All', icon: 'view-grid-outline', categories: [] },
  {
    label: 'Da Vinci',
    icon: 'bottle-soda-outline',
    categories: ['Da Vinci Sauces', 'Da Vinci Syrup', 'Da Vinci Mixologies', 'Da Vinci Powders', 'Da Vinci BeverageMix'],
  },
  {
    label: 'Drinks',
    icon: 'coffee-outline',
    categories: ['Torani', 'Monin', 'Dripp Flavours', 'Top Creamery', 'Full Cream Milk', 'Plant Based Milk', 'Whip Cream', 'Non Dairy Creamer', 'Coffee Beans', 'MATCHA POWDER'],
  },
  {
    label: 'Food & Baking',
    icon: 'food-outline',
    categories: ['Spread_Jams_Biscuits', 'Chicken Pastil', 'Baking Chocolate', 'Condense Milk'],
  },
  { label: 'Packaging', icon: 'package-variant-closed', categories: ['Cups and Lid'] },
  { label: 'Others', icon: 'dots-horizontal-circle-outline', categories: ['Achievers', 'Others', 'Others1'] },
];

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function money(value) {
  return `₱${(Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function HomeScreen({ route, navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sessionUser = useSessionUsername(route.params?.username || null);
  const [featured, setFeatured] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [rankedByAbc, setRankedByAbc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetchSeq = useRef(0);

  const fetchHome = useCallback(async() => {
    const seq = ++fetchSeq.current;
    try {
      const [catalogResponse, abcResponse, inventory] = await Promise.all([
        listAllProducts(),
        getOptimizationAbc().catch(() => []),
        getInventory().catch(() => null),
      ]);
      if (seq !== fetchSeq.current) return;

      const catalog = asList(catalogResponse);
      const abc = asList(abcResponse);
      const stock = stockMapFromInventory(inventory);
      const byId = new Map(catalog.map((item) => [Number(item.id), item]));
      const ranked = abc.map((row) => byId.get(Number(row.id))).filter(Boolean);
      const ordered = [...ranked, ...catalog.filter((item) => !ranked.some((row) => Number(row.id) === Number(item.id)))];
      const available = ordered.filter((item) => stock[Number(item.id)] === undefined || stock[Number(item.id)] > 0);

      setFeatured(available.slice(0, 8));
      setStockMap(stock);
      setRankedByAbc(ranked.length > 0);
    } catch {
      if (seq === fetchSeq.current) {
        setFeatured([]);
        setRankedByAbc(false);
      }
    } finally {
      if (seq === fetchSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchHome();
  }, [fetchHome]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHome();
  }, [fetchHome]);

  const openCategory = (item) => navigation.navigate('CatalogTab', {
    screen: 'Products',
    params: { initialCategory: '', initialCategories: item.categories, initialGroupLabel: item.label },
  });

  const openProduct = (item) => navigation.navigate('CatalogTab', {
    screen: 'Products',
    params: { focusId: item.id },
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
              <View style={styles.brandMarkChip}>
                <Image source={company.symbol} style={styles.brandMark} resizeMode="contain" accessibilityLabel="Sylver logo" />
              </View>
              <View>
                <Text style={styles.brand}>{company.software}</Text>
                <Text style={styles.tagline}>Restaurant & coffee supplies</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.accountButton}
              onPress={() => navigation.navigate('AccountTab')}
              accessibilityRole="button"
              accessibilityLabel={sessionUser ? `Account for ${sessionUser}` : 'Open account and sign in'}
            >
              <MaterialCommunityIcons name="account-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => navigation.navigate('CatalogTab', { screen: 'Search' })}
            activeOpacity={0.8}
            accessibilityRole="search"
            accessibilityLabel="Search products and brands"
          >
            <MaterialCommunityIcons name="magnify" size={21} color={colors.textSecondary} />
            <Text style={styles.searchPlaceholder}>Search products and brands</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={colors.brandPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
          contentContainerStyle={styles.content}
        >
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>WHOLESALE SUPPLIES</Text>
              <Text style={styles.heroTitle}>Stock your next creation.</Text>
              <Text style={styles.heroSubtitle}>Build an order list and ask Sylver’s team for a quote.</Text>
            </View>
            <TouchableOpacity
              style={styles.heroButton}
              onPress={() => navigation.navigate('OrdersTab', { screen: 'OrderInquiry' })}
              accessibilityRole="button"
              accessibilityLabel="Start an order inquiry"
            >
              <Text style={styles.heroButtonText}>Start an inquiry</Text>
              <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Browse categories</Text>
            <TouchableOpacity onPress={() => navigation.navigate('CatalogTab', { screen: 'Categories' })} style={styles.textButton}>
              <Text style={styles.sectionAction}>All</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {HOME_CATEGORY_GROUPS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.categoryChip}
                onPress={() => openCategory(item)}
                accessibilityRole="button"
                accessibilityLabel={`Browse ${item.label} products`}
              >
                <MaterialCommunityIcons name={item.icon} size={19} color={colors.brandPrimary} />
                <Text style={styles.categoryText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>{rankedByAbc ? 'Suggested supplies' : 'Browse supplies'}</Text>
              <Text style={styles.sectionHint}>
                {rankedByAbc ? 'Ranked from the inventory analysis' : 'Current items from the catalog'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('CatalogTab', { screen: 'Recommendations' })} style={styles.textButton}>
              <Text style={styles.sectionAction}>View all</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
            </TouchableOpacity>
          </View>

          {loading && featured.length === 0 ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.mutedText}>Loading supplies…</Text>
            </View>
          ) : featured.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRow}>
              {featured.map((item) => {
                const stock = stockMap[Number(item.id)];
                const stockInfo = stockStatus(stock);
                const stockColor = stockInfo.tone === 'ok'
                  ? colors.success
                  : stockInfo.tone === 'low' ? colors.warning
                    : stockInfo.tone === 'out' ? colors.error : colors.textSecondary;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.productCard}
                    onPress={() => openProduct(item)}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={`${productTitle(item)}, ${money(item.price)}`}
                  >
                    {item.image ? (
                      <Image source={{ uri: imageUrl(item.image) }} style={styles.productImage} resizeMode="contain" />
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <MaterialCommunityIcons name="package-variant-closed" size={34} color={colors.textSecondary} />
                      </View>
                    )}
                    <Text style={styles.productCategory} numberOfLines={1}>{item.category || 'Supply'}</Text>
                    <Text style={styles.productName} numberOfLines={2}>{productTitle(item)}</Text>
                    <Text style={styles.productPrice}>{money(item.price)}</Text>
                    <Text style={[styles.stockText, { color: stockColor }]}>{stockInfo.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="package-variant-closed" size={26} color={colors.textSecondary} />
              <Text style={styles.emptyText}>Supplies are unavailable right now. Pull down to refresh.</Text>
            </View>
          )}
          <View style={styles.bottomSpace} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safeArea: { backgroundColor: colors.brandPrimary, flex: 1 },
  container: { backgroundColor: colors.background, flex: 1 },
  header: { backgroundColor: colors.brandPrimary, paddingBottom: 16, paddingHorizontal: 18, paddingTop: 10 },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  brandMarkChip: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, height: 38, justifyContent: 'center', padding: 4, width: 38 },
  brandMark: { height: '100%', width: '100%' },
  brand: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.2 },
  tagline: { color: 'rgba(255,255,255,0.82)', fontSize: 12, marginTop: 1 },
  accountButton: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  searchButton: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, flexDirection: 'row', gap: 10, height: 50, paddingHorizontal: 14 },
  searchPlaceholder: { color: colors.textSecondary, flex: 1, fontSize: 15 },
  content: { paddingBottom: 12, paddingHorizontal: 18, paddingTop: 18 },
  hero: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, marginBottom: 26, overflow: 'hidden', padding: 18 },
  heroCopy: { marginBottom: 16 },
  heroEyebrow: { color: colors.brandPrimary, fontSize: 12, fontWeight: '800', letterSpacing: 0.9 },
  heroTitle: { color: colors.textPrimary, fontSize: 23, fontWeight: '800', lineHeight: 29, marginTop: 6 },
  heroSubtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  heroButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.brandPrimary, borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 48, paddingHorizontal: 16 },
  heroButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, marginTop: 4 },
  sectionTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  sectionHint: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  textButton: { alignItems: 'center', flexDirection: 'row', minHeight: 48, paddingLeft: 8 },
  sectionAction: { color: colors.brandPrimary, fontSize: 14, fontWeight: '700' },
  categoryRow: { gap: 9, paddingBottom: 24, paddingRight: 4 },
  categoryChip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 48, paddingHorizontal: 13 },
  categoryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  productRow: { gap: 12, paddingBottom: 8, paddingRight: 4 },
  productCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: 12, width: 172 },
  productImage: { height: 116, marginBottom: 10, width: '100%' },
  imagePlaceholder: { alignItems: 'center', backgroundColor: colors.background, borderRadius: 12, height: 116, justifyContent: 'center', marginBottom: 10 },
  productCategory: { color: colors.textSecondary, fontSize: 11, marginBottom: 4 },
  productName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', lineHeight: 19, minHeight: 38 },
  productPrice: { color: colors.brandPrimary, fontSize: 16, fontWeight: '800', marginTop: 8 },
  stockText: { fontSize: 12, fontWeight: '700', marginTop: 5 },
  loading: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 120, paddingHorizontal: 6 },
  mutedText: { color: colors.textSecondary, fontSize: 13 },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 88, padding: 16 },
  emptyText: { color: colors.textSecondary, flex: 1, fontSize: 13, lineHeight: 19 },
  bottomSpace: { height: 20 },
});

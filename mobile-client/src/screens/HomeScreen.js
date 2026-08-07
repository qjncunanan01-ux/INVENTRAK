import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { imageUrl, listAllProducts, listCategories, useSessionUsername } from '../api';
import { colors } from '../theme';

export default function HomeScreen({ route, navigation }) {
  // Guest-first: the catalog opens with no account; the welcome line reflects
  // the session once a customer logs in.
  const username = useSessionUsername(route.params?.username || null) || 'Customer';
  const [featured, setFeatured] = useState([]);
  const [categories, setCategories] = useState(['All']);

  const fetchProducts = useCallback(async () => {
    try {
      // listAllProducts pages past the 100-row clamp so the featured row and
      // the derived categories cover the WHOLE 192-product catalog.
      const items = await listAllProducts();
      // Featured = first few non-empty stock products (placeholder for a real
      // recommendation feed, which is available via the Recommendations tab).
      setFeatured(items.slice(0, 4));
      // Category chips come from the live catalog endpoint (not hardcoded, and
      // not truncated to one page), so all 23 supplier categories show up.
      const cats = await listCategories();
      setCategories(['All', ...(Array.isArray(cats) ? cats : [])]);
    } catch (err) {
      // Home still renders without data
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Shopee-style: tapping the search bar opens the dedicated Search screen.
  const openSearch = () => {
    navigation.navigate('CatalogTab', { screen: 'Search' });
  };

  return (
    <View style={styles.container}>
      {/* Search-first header, Shopee-style: tap opens the Search screen */}
      <View style={styles.header}>
        <Text style={styles.brand}>INVENTRAK</Text>
        <TouchableOpacity style={styles.searchBar} onPress={openSearch} activeOpacity={0.7}>
          <Text style={styles.searchPlaceholder}>⌕  Search supplies, brands...</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Promo banner */}
        <TouchableOpacity
          style={styles.banner}
          onPress={() => navigation.navigate('OrdersTab', { screen: 'OrderInquiry' })}
        >
          <Text style={styles.bannerTag}>WHOLESALE SUPPLIES</Text>
          <Text style={styles.bannerTitle}>Send an order inquiry today</Text>
          <Text style={styles.bannerSub}>Get pricing for your café or store</Text>
        </TouchableOpacity>

        {/* Category chips */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <TouchableOpacity onPress={() => navigation.navigate('CatalogTab', { screen: 'Categories' })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.seeAll}>See all ▸</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          horizontal
          data={categories}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chip}
              onPress={() =>
                navigation.navigate('CatalogTab', {
                  screen: 'Products',
                  params: { initialCategory: item === 'All' ? '' : item },
                })
              }
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          )}
        />

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('CatalogTab', { screen: 'Recommendations' })}
          >
            <Text style={styles.quickGlyph}>★</Text>
            <Text style={styles.quickLabel}>Recommendations</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('OrdersTab', { screen: 'OrderInquiry' })}
          >
            <Text style={styles.quickGlyph}>✎</Text>
            <Text style={styles.quickLabel}>Order Inquiry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('OrdersTab', { screen: 'InquiryHistory' })}
          >
            <Text style={styles.quickGlyph}>✓</Text>
            <Text style={styles.quickLabel}>Order History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('OrdersTab', { screen: 'Notifications' })}
          >
            <Text style={styles.quickGlyph}>🔔</Text>
            <Text style={styles.quickLabel}>Notifications</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('CatalogTab', { screen: 'OCR' })}
          >
            <Text style={styles.quickGlyph}>📷</Text>
            <Text style={styles.quickLabel}>Scan Product</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => navigation.navigate('CatalogTab', { screen: 'StockAvailability' })}
          >
            <Text style={styles.quickGlyph}>🏬</Text>
            <Text style={styles.quickLabel}>Stock Availability</Text>
          </TouchableOpacity>
        </View>

        {/* Multi-location availability teaser */}
        <Text style={styles.sectionTitle}>Multi-Location Stock</Text>
        <TouchableOpacity
          style={styles.locationTeaser}
          onPress={() => navigation.navigate('CatalogTab', { screen: 'StockAvailability' })}
        >
          <Text style={styles.locationTeaserTitle}>🏬 Check supply stock per location</Text>
          <Text style={styles.locationTeaserSub}>See what's available at each branch before you order.</Text>
        </TouchableOpacity>

        {/* Featured products */}
        <Text style={styles.sectionTitle}>Featured Supplies</Text>
        <View style={styles.grid}>
          {featured.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              onPress={() =>
                navigation.navigate('CatalogTab', {
                  screen: 'Products',
                  params: { focusId: item.id },
                })
              }
            >
              <View style={styles.cardTop}>
                {item.image ? (
                  <Image source={{ uri: imageUrl(item.image) }} style={styles.cardImage} resizeMode="cover" />
                ) : null}
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              </View>
              <Text style={styles.cardMeta}>{item.category}</Text>
              <Text style={styles.cardPrice}>P{item.price}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.spacer} />
        <Text style={styles.welcome}>Welcome, {username}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: colors.brandPrimary,
  },
  brand: { color: '#fff', fontSize: 18, fontWeight: '800', marginRight: 12 },
  searchBar: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  searchPlaceholder: { paddingVertical: 9, fontSize: 15, color: colors.textSecondary },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 16,
  },
  seeAll: { color: colors.brandPrimary, fontWeight: '700', fontSize: 13, marginTop: 8, marginBottom: 10 },
  banner: {
    margin: 16,
    padding: 18,
    borderRadius: 14,
    backgroundColor: colors.brandSecondary,
  },
  bannerTag: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  bannerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 4 },
  bannerSub: { color: '#fff', opacity: 0.9, fontSize: 13, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginLeft: 16, marginTop: 8, marginBottom: 10 },
  chipRow: { paddingHorizontal: 16 },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  chipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 16, marginTop: 12 },
  quickItem: {
    width: '31%',
    marginRight: '2%',
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  locationTeaser: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: colors.info,
  },
  locationTeaserTitle: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
  locationTeaserSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  quickGlyph: { fontSize: 20, color: colors.brandPrimary, fontWeight: '700' },
  quickLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 },
  card: {
    width: '48%',
    marginRight: '4%',
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
  },
  cardTop: { minHeight: 40 },
  cardImage: { width: '100%', height: 90, borderRadius: 8, marginBottom: 8, backgroundColor: colors.background },
  cardName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  cardPrice: { fontSize: 15, fontWeight: '800', color: colors.brandPrimary, marginTop: 8 },
  spacer: { height: 16 },
  welcome: { textAlign: 'center', color: colors.textSecondary, fontSize: 13, marginBottom: 24 },
});

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getInventory, getOptimizationAbc, listAllProducts, listCategories, useSessionUsername } from '../api';
import { useCart } from '../cart-context';
import { useLoginGate } from '../login-gate';
import { buildFlashPicks, dealPricing, stockMapFromInventory } from '../flash-sale';
import FlashCarousel from '../FlashCarousel';
import { showToast } from '../toast';
import FlashSaleHeader from '../FlashSaleHeader';
import { useThemeColors } from '../theme-context';
import { categoryIcon } from '../category-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import PressableScale from '../PressableScale';

export default function HomeScreen({ route, navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Guest-first: the catalog opens with no account; the welcome line reflects
  // the session once a customer logs in.
  const sessionUser = useSessionUsername(route.params?.username || null);
  const isLoggedIn = !!sessionUser;
  const { addItem } = useCart();
  // Featured-card quick-add is member-only (guests get the login gate).
  const { requireLogin, gateModal } = useLoginGate(navigation);
  const [featured, setFeatured] = useState([]);
  const [categories, setCategories] = useState(['All']);
  // productId -> total quantity across locations (from the public inventory
  // API), so each featured card can show an honest In stock / Low / Out tag.
  const [stockMap, setStockMap] = useState({});
  // Monotonic fetch sequence: drops stale responses when the screen is
  // blurred/refocused quickly (a slow earlier fetch must not overwrite a
  // fresher one).
  const fetchSeq = useRef(0);

  const fetchProducts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      // Parallel: full catalog (pages past the 100-row clamp), categories,
      // ABC top picks, and stock levels — so the featured row shows REAL
      // recommendations (top-value A-classified supplies), not the first few
      // rows of the catalog.
      const [items, cats, abcData, inv] = await Promise.all([
        listAllProducts(),
        listCategories(),
        getOptimizationAbc().catch(() => []),
        getInventory().catch(() => null),
      ]);
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch

      setCategories(['All', ...(Array.isArray(cats) ? cats : [])]);

      // Today's flash picks, shared with the Recommendations screen (same
      // helper + same inputs -> identical carousels). buildFlashPicks
      // enriches the ABC list, keeps photo + in-stock items, and rotates a
      // deterministic 6-window per local day.
      const stock = stockMapFromInventory(inv);
      const abc = abcData && abcData.data ? abcData.data : (Array.isArray(abcData) ? abcData : []);
      setFeatured(buildFlashPicks(abc, items, stock));
      setStockMap(stock);
    } catch (err) {
      // Home still renders without data
    }
  }, []);

  // Refetch whenever Home regains focus so admin edits (new products, price
  // changes) appear without killing and reopening the app. Wrapped in a
  // non-async callback so useFocusEffect never receives a Promise as its
  // cleanup return value.
  useFocusEffect(useCallback(() => { fetchProducts(); }, [fetchProducts]));

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
        {/* Promo banner (scales on press like every card on Home) */}
        <PressableScale
          style={styles.banner}
          pressableStyle={styles.cardContent}
          onPress={() => navigation.navigate('OrdersTab', { screen: 'OrderInquiry' })}
        >
          <Text style={styles.bannerTag}>WHOLESALE SUPPLIES</Text>
          <Text style={styles.bannerTitle}>Send an order inquiry today</Text>
          <Text style={styles.bannerSub}>Get pricing for your café or store</Text>
        </PressableScale>

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
            <PressableScale
              style={styles.chip}
              pressableStyle={styles.chipPressable}
              onPress={() =>
                navigation.navigate('CatalogTab', {
                  screen: 'Products',
                  params: { initialCategory: item === 'All' ? '' : item },
                })
              }
            >
              {/* Icon + label (Shopee-style chip): real category glyph, not
                  bare text. 'All' uses a grid glyph. */}
              {item === 'All' ? (
                <MaterialCommunityIcons name="view-grid-outline" size={15} color={colors.brandPrimary} />
              ) : (
                <MaterialCommunityIcons name={categoryIcon(item)} size={15} color={colors.brandPrimary} />
              )}
              <Text style={styles.chipText}>{item}</Text>
            </PressableScale>
          )}
        />

        {/* Quick actions. Personal features (Order History, Notifications,
            Scan Product) are MEMBER-ONLY — hidden from guests. Guests see the
            public trio plus a Log In tile so the grid stays balanced and the
            account value is obvious (Shopee/Lazada pattern). */}
        <View style={styles.quickRow}>
          {quickActions(isLoggedIn, navigation).map((a) => (
            <PressableScale
              key={a.key}
              style={[styles.quickItem, a.primary && styles.quickItemPrimary]}
              onPress={a.onPress}
            >
              {/* Shopee-style colored icon disc: each action gets a tinted
                  circular badge behind its vector icon; the primary CTA
                  (Log In) gets a solid filled disc instead. */}
              <View
                style={[
                  styles.quickDisc,
                  a.primary
                    ? styles.quickDiscPrimary
                    : { backgroundColor: a.tint.bg },
                ]}
              >
                <MaterialCommunityIcons
                  name={a.icon}
                  size={22}
                  color={a.primary ? '#fff' : a.tint.fg}
                />
              </View>
              <Text style={[styles.quickLabel, a.primary && styles.quickLabelPrimary]}>{a.label}</Text>
            </PressableScale>
          ))}
        </View>
        {!isLoggedIn ? (
          <Text style={styles.guestNudge}>
            🔒 Order history, notifications & product scanning unlock when you log in.
          </Text>
        ) : null}

        {/* Multi-location availability teaser (scales on press) */}
        <Text style={styles.sectionTitle}>Multi-Location Stock</Text>
        <PressableScale
          style={styles.locationTeaser}
          pressableStyle={styles.cardContent}
          onPress={() => navigation.navigate('CatalogTab', { screen: 'StockAvailability' })}
        >
          <Text style={styles.locationTeaserTitle}>🏬 Check supply stock per location</Text>
          <Text style={styles.locationTeaserSub}>See what's available at each branch before you order.</Text>
        </PressableScale>

        {/* Flash Sale — Shopee-style urgency: a live countdown to the daily
            midnight refresh, after which the featured picks rotate to a
            fresh window of the value-ranked ABC list (see flash-sale.js).
            'View all top picks' opens the full ranked Recommendations list
            (same data source, so the carousel and the ranked list always
            feel connected). Refetches on focus AND when the countdown hits
            zero, so admin edits and the day rotation show up live. */}
        <FlashSaleHeader
          onRefresh={fetchProducts}
          onViewAll={() => navigation.navigate('CatalogTab', { screen: 'Recommendations' })}
        />
        <FlashCarousel
          items={featured}
          stockMap={stockMap}
          onPressItem={(item) =>
            navigation.navigate('CatalogTab', {
              screen: 'Products',
              params: { focusId: item.id },
            })
          }
          onAdd={(item) =>
            requireLogin(() => {
              // Snapshot the day's deal price so the cart matches the card.
              const d = dealPricing(item);
              addItem(item, 1, d ? d.deal : undefined, d ? d.original : undefined);
              showToast('Added to cart', {
                actionLabel: 'View',
                onAction: () => navigation.navigate('CartTab'),
              });
            })
          }
        />

        <View style={styles.spacer} />
        {/* Honest welcome line: the seeded demo account is NOT logged in on
            boot — the app always opens as a guest. Show the real username
            only when a customer actually signs in, never a fake "Customer". */}
        {isLoggedIn ? (
          <Text style={styles.welcome}>Welcome, {sessionUser}! 🎉</Text>
        ) : (
          <Text style={styles.welcome}>
            Browsing as a guest — create a free account when you're ready to order.
          </Text>
        )}
      </ScrollView>
      {gateModal}
    </View>
  );
}

// Builds the Home quick-action tiles. Public actions stay for everyone;
// member actions (order history, notifications, scanning) only render for
// logged-in customers, who also get a Log In tile in their place. `icon` is a
// MaterialCommunityIcons name (real vector glyph, Shopee/Lazada-style) — the
// renderer below maps it through the icon component.
function quickActions(isLoggedIn, navigation) {
  const go = (screen, params) => navigation.navigate(screen, params);
  // `tint` drives the Shopee-style colored icon disc: a pastel background
  // with a deeper accent icon color, picked to stay on-brand with the green
  // palette while giving each tile its own identity.
  const publicActions = [
    { key: 'recs', icon: 'star-circle-outline', label: 'Recommendations', tint: { bg: '#fff3e0', fg: '#f9a825' }, onPress: () => go('CatalogTab', { screen: 'Recommendations' }) },
    { key: 'inquiry', icon: 'message-text-outline', label: 'Order Inquiry', tint: { bg: '#e8f0fe', fg: '#1565c0' }, onPress: () => go('OrdersTab', { screen: 'OrderInquiry' }) },
    { key: 'stock', icon: 'store-outline', label: 'Stock Availability', tint: { bg: '#e0f2f1', fg: '#00796b' }, onPress: () => go('CatalogTab', { screen: 'StockAvailability' }) },
  ];
  if (!isLoggedIn) {
    return [
      ...publicActions,
      {
        key: 'login',
        icon: 'account-outline',
        label: 'Log In',
        primary: true,
        onPress: () => go('AccountTab'),
      },
    ];
  }
  return [
    ...publicActions,
    { key: 'history', icon: 'clipboard-text-clock-outline', label: 'Order History', tint: { bg: '#e8eaf6', fg: '#3f51b5' }, onPress: () => go('OrdersTab', { screen: 'InquiryHistory' }) },
    { key: 'notif', icon: 'bell-outline', label: 'Notifications', tint: { bg: '#fde8ec', fg: '#e23744' }, onPress: () => go('OrdersTab', { screen: 'Notifications' }) },
    { key: 'ocr', icon: 'camera-outline', label: 'Scan Product', tint: { bg: '#f3e5f5', fg: '#8e24aa' }, onPress: () => go('CatalogTab', { screen: 'OCR' }) },
  ];
}

const createStyles = (colors) => StyleSheet.create({
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
  // The chip's row layout lives on the PressableScale inner pressable so the
  // icon + label sit side by side (the animated shell only carries the box).
  chipPressable: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Card-like surfaces with left-aligned text need the inner pressable to
  // stretch children full-width (PressableScale centers by default).
  cardContent: { alignItems: 'stretch' },
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
  quickDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickDiscPrimary: { backgroundColor: colors.brandPrimary },
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
  quickLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  quickItemPrimary: { backgroundColor: colors.brandPrimary },
  quickLabelPrimary: { color: '#fff', fontWeight: '700' },
  guestNudge: {
    marginHorizontal: 16,
    marginTop: -2,
    marginBottom: 4,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  spacer: { height: 16 },
  welcome: { textAlign: 'center', color: colors.textSecondary, fontSize: 13, marginBottom: 24 },
});

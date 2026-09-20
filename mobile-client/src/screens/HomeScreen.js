import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getInventory, getOptimizationAbc, listAllProducts, useSessionUsername} from '../api';
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
import WaveHeader from '../WaveHeader';
import AnimatedEntry from '../AnimatedEntry';
import MotiCard from '../MotiCard';

const HOME_CATEGORY_GROUPS = [
  {
    label: 'All',
    icon: 'view-grid-outline',
    categories: [],
  },
  {
    label: 'Da Vinci Products',
    icon: 'bottle-soda-outline',
    categories: [
      'Da Vinci Sauces',
      'Da Vinci Syrup',
      'Da Vinci Mixologies',
      'Da Vinci Powders',
      'Da Vinci Beverage Mix',
    ],
  },
  {
    label: 'Drinks & Ingredients',
    icon: 'coffee-outline',
    categories: [
      'Torani',
      'Monin',
      'Dripp Flavours',
      'Top Creamery',
      'Full Cream Milk',
      'Plant Based Milk',
      'Whip Cream',
      'Non Dairy Creamer',
      'Coffee Beans',
      'Matcha Powder',
    ],
  },
  {
    label: 'Food & Baking',
    icon: 'food-outline',
    categories: [
      'Spread/Jams/Biscuits',
      'Chicken Pastil',
      'Baking Chocolate',
      'Condensed Milk',
    ],
  },
  {
    label: 'Packaging & Supplies',
    icon: 'package-variant-closed',
    categories: [
      'Cups and Lid',
    ],
  },
  {
    label: 'Others',
    icon: 'dots-horizontal-circle-outline',
    categories: [
      'Achievers',
      'Others',
    ],
  },
];

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
  const [guestPopupVisible, setGuestPopupVisible] = useState(false);
  // productId -> total quantity across locations (from the public inventory
  // API), so each featured card can show an honest In stock / Low / Out tag.
  const [stockMap, setStockMap] = useState({});
  // Monotonic fetch sequence: drops stale responses when the screen is
  // blurred/refocused quickly (a slow earlier fetch must not overwrite a
  // fresher one).
  const fetchSeq = useRef(0);

  const fetchProducts = useCallback(async() => {
    const seq = ++fetchSeq.current;

    try {
      const [items, abcData, inv] = await Promise.all([
        listAllProducts(),
        getOptimizationAbc().catch(() => []),
        getInventory().catch(() => null),
      ]);

      if (seq !== fetchSeq.current) return;

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
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Haikei-style gradient header with wave bottom */}
        <WaveHeader height={180}>
          <View style={styles.topRow}>
            <Text style={styles.brand}>INVENTRAK</Text>

            <TouchableOpacity
              style={styles.userStatus}
              onPress={() => {
                if (isLoggedIn) {
                  navigation.navigate('AccountTab');
                } else {
                  setGuestPopupVisible(true);
                }
              }}
              activeOpacity={0.7}
              accessibilityLabel={isLoggedIn ? `Logged in as ${sessionUser}. Tap to view account.` : 'Guest mode. Tap to log in.'}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons
                name={isLoggedIn ? 'account-circle' : 'account-circle-outline'}
                size={32}
                color="#fff"
              />

              <View style={styles.userStatusInfo}>
                <Text
                  style={styles.userStatusName}
                  numberOfLines={1}
                >
                  {isLoggedIn ? sessionUser : 'Guest'}
                </Text>

                <Text style={styles.tapToLogin}>
                  {isLoggedIn ? 'View Account' : 'Tap Here to Log In'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.searchBar}
            onPress={openSearch}
            activeOpacity={0.7}
            accessibilityLabel="Search supplies, brands"
            accessibilityRole="search"
          >
            <MaterialCommunityIcons
              name="magnify"
              size={18}
              color="rgba(255,255,255,0.7)"
            />

            <Text style={styles.searchPlaceholder}>
      Search supplies, brands…
            </Text>
          </TouchableOpacity>
        </WaveHeader>

        {/* Promo banner — animated entrance (Watermelon/Motion-Primitives style) */}
        <MotiCard delay={100} entrance="slide" onPress={() => navigation.navigate('OrdersTab', { screen: 'OrderInquiry' })} style={styles.banner}>
          <Text style={styles.bannerTag}>WHOLESALE SUPPLIES</Text>
          <Text style={styles.bannerTitle}>Send an order inquiry today</Text>
          <Text style={styles.bannerSub}>Get pricing for your café or store</Text>
        </MotiCard>

        {/* Quick Actions section — animated entrance */}
        <AnimatedEntry delay={200} preset="fade">
          <Text style={styles.sectionTitle}>Quick Actions</Text>

          {/* Quick actions. Personal features (Order History, Notifications,
            Scan Product) are MEMBER-ONLY — hidden from guests. Guests see the
            public trio plus a Log In tile so the grid stays balanced and the
            account value is obvious (Shopee/Lazada pattern). */}
          <View style={styles.quickRow}>
            {quickActions(isLoggedIn, navigation).map((a, idx) => (
              <MotiCard
                key={a.key}
                delay={250 + idx * 60}
                entrance="pop"
                onPress={a.onPress}
                style={[styles.quickItem, a.primary && styles.quickItemPrimary]}
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
              </MotiCard>
            ))}
          </View>
          {!isLoggedIn ? (
            <Text style={styles.guestNudge}>
    🔒 Sign in to access order history, notifications, and product scanning.
            </Text>
          ) : null}
        </AnimatedEntry>

        {/* Grouped Home categories — animated entrance */}
        <AnimatedEntry delay={300} preset="slide">
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Categories</Text>

            <TouchableOpacity
              onPress={() =>
                navigation.navigate('CatalogTab', {
                  screen: 'Categories',
                })
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAll}>See all ▸</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.groupCategoryGrid}>
            {HOME_CATEGORY_GROUPS.map((item) => (
              <MotiCard
                key={item.label}
                delay={350}
                entrance="fade"
                onPress={() =>
                  navigation.navigate('CatalogTab', {
                    screen: 'Products',
                    params: {
                      initialCategory: '',
                      initialCategories: item.categories,
                      initialGroupLabel: item.label,
                    },
                  })
                }
                style={styles.groupCategoryCard}
                contentStyle={styles.groupCategoryCardInner}
                accessibilityLabel={`Browse ${item.label} products`}
                accessibilityRole="button"
              >
                <View style={styles.groupCategoryIcon}>
                  <MaterialCommunityIcons
                    name={item.icon}
                    size={18}
                    color={colors.brandPrimary}
                  />
                </View>

                <Text
                  style={styles.groupCategoryText}
                  numberOfLines={2}
                >
                  {item.label}
                </Text>
              </MotiCard>
            ))}
          </View>
        </AnimatedEntry>

        {/* Flash Sale — Shopee-style urgency: a live countdown to the daily
            midnight refresh, after which the featured picks rotate to a
            fresh window of the value-ranked ABC list (see flash-sale.js).
            'View all top picks' opens the full ranked Recommendations list
            (same data source, so the carousel and the ranked list always
            feel connected). Refetches on focus AND when the countdown hits
            zero, so admin edits and the day rotation show up live. */}
        {featured.length > 0 ? (
          <>
            <FlashSaleHeader
              onRefresh={fetchProducts}
              onViewAll={() =>
                navigation.navigate('CatalogTab', {
                  screen: 'Recommendations',
                })
              }
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
                  const d = dealPricing(item);

                  addItem(
                    item,
                    1,
                    d ? d.deal : undefined,
                    d ? d.original : undefined,
                  );

                  showToast('Added to cart', {
                    actionLabel: 'View',
                    onAction: () => navigation.navigate('CartTab'),
                  });
                })
              }
            />
          </>
        ) : (
          <View style={styles.flashEmpty}>
            <MaterialCommunityIcons
              name="sale-outline"
              size={30}
              color={colors.brandPrimary}
            />

            <Text style={styles.flashEmptyTitle}>
      No deals available right now
            </Text>

            <Text style={styles.flashEmptyText}>
      Check back later for new featured offers.
            </Text>
          </View>
        )}

        <View style={styles.spacer} />
        {/* Honest welcome line: the seeded demo account is NOT logged in on
            boot — the app always opens as a guest. Show the real username
            only when a customer actually signs in, never a fake "Customer". */}

      </ScrollView>

      <Modal
        visible={guestPopupVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGuestPopupVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.guestModal}>

            <MaterialCommunityIcons
              name="account-circle-outline"
              size={48}
              color={colors.brandPrimary}
            />

            <Text style={styles.guestModalTitle}>
              You're browsing as a Guest
            </Text>

            <Text style={styles.guestModalText}>
              Log in or create an account to access your account features and continue with ordering.
            </Text>

            <View style={styles.guestModalButtons}>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setGuestPopupVisible(false)}
                activeOpacity={0.8}
                accessibilityLabel="Cancel and close"
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.loginButton}
                onPress={() => {
                  setGuestPopupVisible(false);
                  navigation.navigate('Login');
                }}
                activeOpacity={0.8}
                accessibilityLabel="Go to login or sign up"
                accessibilityRole="button"
              >
                <Text style={styles.loginButtonText}>
                  Log In / Sign Up
                </Text>
              </TouchableOpacity>

            </View>

          </View>
        </View>
      </Modal>

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
    { key: 'recs', icon: 'star-circle-outline', label: 'Recommend Supplies', tint: { bg: '#fff3e0', fg: '#f9a825' }, onPress: () => go('CatalogTab', { screen: 'Recommendations' }) },
    { key: 'inquiry', icon: 'message-text-outline', label: 'Order Inquiry', tint: { bg: '#e8f0fe', fg: '#1565c0' }, onPress: () => go('OrdersTab', { screen: 'OrderInquiry' }) },
    { key: 'stock', icon: 'store-outline', label: 'Check Product Availability', tint: { bg: '#e0f2f1', fg: '#00796b' }, onPress: () => go('CatalogTab', { screen: 'StockAvailability' }) },
  ];
  if (!isLoggedIn) {
    return publicActions;
  }
  return [
    ...publicActions,
    { key: 'history', icon: 'clipboard-text-clock-outline', label: 'Order History', tint: { bg: '#e8eaf6', fg: '#3f51b5' }, onPress: () => go('OrdersTab', { screen: 'InquiryHistory' }) },
    { key: 'notif', icon: 'bell-outline', label: 'Notifications', tint: { bg: '#fde8ec', fg: '#e23744' }, onPress: () => go('OrdersTab', { screen: 'Notifications' }) },
    { key: 'ocr', icon: 'camera-outline', label: 'Scan Product', tint: { bg: '#f3e5f5', fg: '#8e24aa' }, onPress: () => go('CatalogTab', { screen: 'OCR' }) },
  ];
}

const createStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },

  fullStickyHeader: {
    backgroundColor: colors.brandPrimary,
    elevation: 6,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 18,
    zIndex: 20,
  },

  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },

  brand: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  userStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    width: 145,
  },

  userStatusInfo: {
    flex: 1,
    marginLeft: 7,
  },

  userStatusName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },

  tapToLogin: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
    textDecorationLine: 'underline',
  },

  searchBar: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    flexDirection: 'row',
    height: 38,
    paddingHorizontal: 14,
    width: '100%',
  },

  searchPlaceholder: {
    color: colors.textSecondary,
    fontSize: 14,
    marginLeft: 8,
  },
  sectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginRight: 16,
  },
  seeAll: { color: colors.brandPrimary, fontSize: 13, fontWeight: '700', marginBottom: 10, marginTop: 8 },
  banner: {
    backgroundColor: colors.brandSecondary,
    borderRadius: 14,
    margin: 16,
    padding: 18,
  },
  bannerTag: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  bannerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 4 },
  bannerSub: { color: '#fff', fontSize: 13, marginTop: 4, opacity: 0.9 },
  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 10, marginLeft: 16, marginTop: 8 },
  groupCategoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 16,
  },

  groupCategoryCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    minHeight: 54,
    width: '48.5%',
  },

  groupCategoryCardInner: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  groupCategoryIcon: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    marginRight: 8,
    width: 30,
  },

  groupCategoryText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  // The chip's row layout lives on the PressableScale inner pressable so the
  // icon + label sit side by side (the animated shell only carries the box).

  // Card-like surfaces with left-aligned text need the inner pressable to
  // stretch children full-width (PressableScale centers by default).
  cardContent: { alignItems: 'stretch' },

  quickRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 16, marginTop: 12 },
  quickItem: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 10,
    marginRight: '2%',
    paddingHorizontal: 6,
    paddingVertical: 14,
    width: '31%',
  },
  quickDisc: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  quickDiscPrimary: { backgroundColor: colors.brandPrimary },
  locationTeaser: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.info,
    borderLeftWidth: 4,
    borderRadius: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    padding: 14,
  },
  locationTeaserTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  locationTeaserSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  quickLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 6, textAlign: 'center' },
  quickItemPrimary: { backgroundColor: colors.brandPrimary },
  quickLabelPrimary: { color: '#fff', fontWeight: '700' },
  guestNudge: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
    marginHorizontal: 16,
    marginTop: -2,
  },
  spacer: { height: 16 },

  flashEmpty: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },

  flashEmptyTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },

  flashEmptyText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },

  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  guestModal: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    maxWidth: 360,
    padding: 24,
    width: '100%',
  },

  guestModalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
  },

  guestModalText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 22,
    marginTop: 8,
    textAlign: 'center',
  },

  guestModalButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },

  cancelButton: {
    alignItems: 'center',
    borderColor: colors.brandPrimary,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },

  cancelButtonText: {
    color: colors.brandPrimary,
    fontSize: 13,
    fontWeight: '700',
  },

  loginButton: {
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    flex: 1.5,
    paddingVertical: 12,
  },

  loginButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

});

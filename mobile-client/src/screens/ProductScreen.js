import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getInventory, getOptimizationAbc, imageUrl, listAllProducts } from '../api';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCart } from '../cart-context';
import { MODAL_ANIMATION } from '../Dialog';
import { useLoginGate } from '../login-gate';
import { showToast } from '../toast';
import { buildFlashPicks, dealPricing, stockMapFromInventory } from '../flash-sale';
import {
  bulkTiers,
  describeProduct,
  moqOf,
  productRating,
  similarProducts,
  stockStatus,
} from '../product-enrichment';
import { useThemeColors } from '../theme-context';
import AnimatedEntry from '../AnimatedEntry';

const SORT_OPTIONS = [
  { key: 'default', label: 'Featured' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'priceAsc', label: 'Price ↑' },
  { key: 'priceDesc', label: 'Price ↓' },
];

// Small deal-price row shared by the PDP and the cross-sell cards: the day's
// fake sale price (red) + struck original + -% tag (Shopee flash look).
function DealPrice({ deal, size = 'md', styles }) {
  if (!deal) return null;
  return (
    <View style={styles.dealRow} accessible accessibilityLabel={`Deal price P${deal.deal}, originally P${deal.original}, ${deal.pct} percent off`}>
      <Text style={[styles.dealPrice, size === 'lg' && styles.dealPriceLg]}>P{deal.deal}</Text>
      <Text style={styles.dealOriginal}>P{deal.original}</Text>
      <Text style={styles.dealOff}>-{deal.pct}%</Text>
    </View>
  );
}

export default function ProductScreen({ route, navigation }) {
  const initialSearch = route.params?.initialSearch || '';
  const initialCategory = route.params?.initialCategory || '';
  const initialCategories = route.params?.initialCategories || [];
  const initialGroupLabel = route.params?.initialGroupLabel || '';
  const focusId = route.params?.focusId;

  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState(initialSearch);
  const [category, setCategory] = useState(initialCategory);
  const [categoryGroup, setCategoryGroup] = useState(initialCategories);
  const [groupLabel, setGroupLabel] = useState(initialGroupLabel);
  const [sort, setSort] = useState('default');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [locStock, setLocStock] = useState(null);
  const [addedToCart, setAddedToCart] = useState(null);
  // Today's flash picks (id set) — the PDP shows the 🔥 Deal of the day price
  // ONLY for items that are actually in today's rotation, so the detail page
  // matches the Home/Recommendations carousels exactly (same helper + inputs).
  const [pickIds, setPickIds] = useState(new Set());
  // Scroll the PDP back to the top whenever the open product changes (a
  // cross-sell tap would otherwise keep the old scroll offset mid-detail).
  const scrollRef = useRef(null);
  const { addItem } = useCart();
  // Guests cannot add to cart — every add affordance routes through this gate.
  const { requireLogin, gateModal } = useLoginGate(navigation);
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const fetchProducts = useCallback(async () => {
    try {
      // Parallel: full catalog (pages past the 100-row clamp), ABC ranking and
      // stock levels — the last two are what determine today's flash picks,
      // so the PDP can show the same deal pricing as the carousels.
      const [items, abcData, inv] = await Promise.all([
        listAllProducts(),
        getOptimizationAbc().catch(() => []),
        getInventory().catch(() => null),
      ]);
      setProducts(items);
      const abc = abcData && abcData.data ? abcData.data : (Array.isArray(abcData) ? abcData : []);
      const stock = stockMapFromInventory(inv);
      setPickIds(new Set(buildFlashPicks(abc, items, stock).map((p) => Number(p.id))));
    } catch (err) {
      // Toast (not Alert.alert) so the failure is visible on react-native-web
      // too — Alert is a silent no-op there, and this is the catalog's only
      // error surface.
      showToast('Failed to load products. Pull down to retry.');
      Alert.alert('Error', 'Failed to load products. Please pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Deep-link focus: when Home (quick tile) or the OCR scanner navigates here
  // with focusId, open that product's PDP after the catalog loads. Consumed
  // once per navigation (lastFocusRef), so closing the PDP clears the param
  // and the same product can be re-opened by a second scan.
  const lastFocusRef = useRef(null);
  useEffect(() => {
    if (!focusId || lastFocusRef.current === focusId) return;
    if (products.length === 0) return;
    const found = products.find((p) => Number(p.id) === Number(focusId));
    if (found) {
      lastFocusRef.current = focusId;
      setSelected(found);
    }
  }, [focusId, products]);

  const closePdp = () => {
    setSelected(null);
    lastFocusRef.current = null;
    navigation.setParams({ focusId: undefined });
  };

  // Multi-location inventory (reviewer requirement): when a product is open,
  // fetch the per-location stock breakdown from the public /api/inventory.
  useEffect(() => {
    if (!selected) { setLocStock(null); return; }
    let cancelled = false;
    getInventory()
      .then((r) => {
        if (cancelled) return;
        const parsed = r && r.data ? r.data : r;
        const item = (parsed.items || []).find((i) => Number(i.product?.id) === Number(selected.id));
        if (item) setLocStock({ locations: parsed.locations || [], item });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  // Cross-sell strip is the only expensive derivation (scoring 192 products),
  // so memoize it on (selected, products) instead of re-scoring every render.
  const sim = useMemo(
    () => (selected ? similarProducts(selected, products, 6) : []),
    [selected, products]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [selected?.id]);

  // Sync search/category when Home navigates here with new params while the
  // screen is already mounted (useState initializers only run on first mount).
  useEffect(() => {
    if (route.params?.initialSearch !== undefined) setFilter(route.params.initialSearch);
    if (route.params?.initialCategory !== undefined) setCategory(route.params.initialCategory);
    if (route.params?.initialCategories !== undefined) setCategoryGroup(route.params.initialCategories);
    if (route.params?.initialGroupLabel !== undefined) setGroupLabel(route.params.initialGroupLabel);
  }, [route.params?.initialSearch, route.params?.initialCategory, route.params?.initialCategories, route.params?.initialGroupLabel]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts();
  }, [fetchProducts]);

  const categories = useMemo(
    () => ['', ...new Set(products.map((p) => p.category).filter(Boolean))],
    [products]
  );

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      const q = filter.toLowerCase().trim();
      const matchQ = !q || (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
      // Support both single category and category group (array of categories)
      const matchC = categoryGroup.length > 0
        ? categoryGroup.includes(p.category)
        : (!category || p.category === category);
      return matchQ && matchC;
    });
    if (sort === 'name') list = [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    else if (sort === 'priceAsc') list = [...list].sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    else if (sort === 'priceDesc') list = [...list].sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    return list;
  }, [products, filter, category, sort]);

  // First-load skeleton: a ghost of the real catalog (search bar + chips +
  // a card grid) instead of a bare spinner, so the layout is stable and the
  // screen feels faster (skeleton = perceived instant paint).
  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <View style={styles.skelSearch} />
        <View style={styles.skelChips} />
        <View style={styles.skelGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.skelCard}>
              <View style={styles.skelImage} />
              <View style={styles.skelLine} />
              <View style={styles.skelLineShort} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // ---- PDP: sticky "Send Inquiry" bar (Shopee/Lazada pattern) ----
  if (selected) {
    // Derived, deterministic selling-point details (see product-enrichment.js).
    const rating = productRating(selected);
    const blurb = describeProduct(selected);
    const tiers = bulkTiers(selected);
    const moq = moqOf(selected);
    // Today's deal price ONLY if this item is one of today's flash picks —
    // matches the Home/Recommendations carousels (same helper + day seed).
    const deal = pickIds.has(Number(selected.id)) ? dealPricing(selected) : null;
    const totalStock = locStock
      ? Object.keys(locStock.item.locations || {}).reduce(
          (s, k) => s + (Number(locStock.item.locations[k]) || 0),
          0
        )
      : undefined;
    const status = stockStatus(totalStock);
    const stockColor =
      status.tone === 'out' ? colors.error : status.tone === 'low' ? colors.warning : colors.success;
    const filled = Math.round(rating.rating);
    const stars = '★'.repeat(filled) + '☆'.repeat(5 - filled);

    return (
      <View style={styles.container}>
        <ScrollView ref={scrollRef} style={styles.pdp} contentContainerStyle={styles.pdpContent}>
          <TouchableOpacity onPress={closePdp} style={styles.backLink} accessibilityLabel="Go back to products" accessibilityRole="button">
            <Text style={styles.backText}>{'< Back to products'}</Text>
          </TouchableOpacity>

          <View style={styles.detailCard}>
            {selected.image ? (
              <Image source={{ uri: imageUrl(selected.image) }} style={styles.detailImage} resizeMode="cover" />
            ) : null}
            <Text style={styles.detailTitle}>{selected.name}</Text>
            <View style={styles.ratingRow}>
              <Text style={styles.ratingStars}>{stars}</Text>
              <Text style={styles.ratingText}>{rating.rating} ({rating.reviews} reviews)</Text>
            </View>
            <Text style={styles.detailCategory}>{selected.category}</Text>

            {/* Price area: the day's deal (red + struck original + -%) when the
                item is a flash pick, otherwise the plain catalog price. */}
            {deal ? (
              <View>
                <DealPrice deal={deal} size="lg" styles={styles} />
                <View style={styles.dealChip}>
                  <Text style={styles.dealChipText}>🔥 Deal of the day</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.detailPrice}>P{selected.price}</Text>
            )}
            {/* The cart snapshots the DEAL price for pick items so the basket
                + checkout total match what the customer saw — the carousel's
                fake sale is honored end-to-end, not just shown. */}

            <View style={styles.sellerRow}>
              <Text style={styles.sellerText}>✔ Sold & shipped by Sylver Restaurant & Cafe Supplier</Text>
            </View>

            <Text style={styles.detailDesc}>{blurb}</Text>

            <View style={styles.detailRow}><Text style={styles.detailLabel}>Brand:</Text><Text>{selected.brand || '-'}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Size:</Text><Text>{selected.size || '-'}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Unit:</Text><Text>{selected.unit || 'pcs'}</Text></View>

            {/* MOQ + honest stock signal (derived from live inventory) */}
            <View style={styles.metaRow}>
              <View style={styles.moqPill}>
                <Text style={styles.moqText}>
                  MOQ: {moq} {selected.unit || 'pcs'}{moq > 1 ? 's' : null}
                </Text>
              </View>
              {totalStock !== undefined ? (
                <View style={[styles.stockPill, { borderColor: stockColor }]}>
                  <Text style={[styles.stockText, { color: stockColor }]}>
                    {status.label} · {totalStock} in stock
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Wholesale tiers — the supplier's "buy more, save" story */}
            {tiers.length > 0 ? (
              <View style={styles.tierCard}>
                <Text style={styles.tierTitle}>💰 Wholesale pricing — buy more, save</Text>
                {tiers.map((t) => (
                  <View key={t.qty} style={styles.tierRow}>
                    <Text style={styles.tierLabel}>{t.label}</Text>
                    <Text style={styles.tierSave}>−{t.savePct}%</Text>
                    <Text style={styles.tierPrice}>P{t.unitPrice}/unit</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Multi-location availability */}
            <View style={styles.locCard}>
              <Text style={styles.locTitle}>🏬 Available stock per location</Text>
              {locStock ? (
                locStock.locations.map((l) => {
                  const name = typeof l === 'object' ? l.name : l;
                  const qty = locStock.item.locations[name] ?? 0;
                  return (
                    <View key={name} style={styles.locRow}>
                      <Text style={styles.locName}>{name}</Text>
                      <Text style={[styles.locQty, qty === 0 && styles.locQtyZero]}>{qty}</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.locEmpty}>Loading stock levels…</Text>
              )}
            </View>

            {/* Cross-sell strip: same category first, so a customer looking at
                a syrup can grab the matching flavor without hunting. */}
            {sim.length > 0 ? (
              <View style={styles.simSection}>
                <Text style={styles.simTitle}>🛒 Customers also ordered</Text>
                <FlatList
                  horizontal
                  data={sim}
                  keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => {
                    const simDeal = pickIds.has(Number(item.id)) ? dealPricing(item) : null;
                    return (
                      <TouchableOpacity style={styles.simCard} onPress={() => setSelected(item)}>
                        {item.image ? (
                          <Image source={{ uri: imageUrl(item.image) }} style={styles.simImage} resizeMode="cover" />
                        ) : null}
                        <Text style={styles.simName} numberOfLines={2}>{item.name}</Text>
                        {simDeal ? (
                          <DealPrice deal={simDeal} styles={styles} />
                        ) : (
                          <Text style={styles.simPrice}>P{item.price}</Text>
                        )}
                        <TouchableOpacity
                          style={styles.simAdd}
                          onPress={() =>
                            requireLogin(() => {
                              addItem(item, 1, simDeal ? simDeal.deal : undefined, simDeal ? simDeal.original : undefined);
                              showToast('Added to cart', {
                                actionLabel: 'View',
                                onAction: () => navigation.navigate('CartTab'),
                              });
                            })
                          }
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        >
                          <Text style={styles.simAddText}>+</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>              <TouchableOpacity
                style={styles.addCartBtn}
                onPress={() =>
                  requireLogin(() => {
                    addItem(selected, 1, deal ? deal.deal : undefined, deal ? deal.original : undefined);
                    setAddedToCart(selected);
                  })
                }
                accessibilityLabel="Add to cart"
                accessibilityRole="button"
              >
            <Text style={styles.addCartBtnText}>Add to Cart</Text>
          </TouchableOpacity>              <TouchableOpacity
                style={styles.stickyBtn}
                onPress={() =>
                  requireLogin(() => {
                    addItem(selected, 1, deal ? deal.deal : undefined, deal ? deal.original : undefined);
                    navigation.navigate('OrdersTab', {
                      screen: 'OrderInquiry',
                      params: { preselectId: selected.id },
                    });
                  })
                }
                accessibilityLabel="Buy now"
                accessibilityRole="button"
              >
            <Text style={styles.stickyBtnText}>Buy Now</Text>
          </TouchableOpacity>
        </View>
        {gateModal}
        {addedToCart ? (
          <Modal
            visible
            transparent
            // Native animates reliably; RN-web's CSS animation can stall in
            // embedded webviews and leave a click-through ghost — skip it
            // there (MODAL_ANIMATION is the shared web-safe rule).
            animationType={MODAL_ANIMATION}
            onRequestClose={() => setAddedToCart(null)}
          >
            <View style={styles.addedBackdrop}>
              <View style={styles.addedCard}>
                <Text style={styles.addedGlyph}>🛒</Text>
                <Text style={styles.addedTitle}>Added to cart</Text>
                <Text style={styles.addedName} numberOfLines={2}>{addedToCart.name}</Text>
                {/* The confirmation shows the same price the customer saw: the
                    deal price when this item is a flash pick, else the plain
                    catalog price — so the checkout path matches the carousel. */}
                {pickIds.has(Number(addedToCart.id)) ? (
                  <View style={styles.addedDealWrap}>
                    <DealPrice deal={dealPricing(addedToCart)} size="lg" styles={styles} />
                    <View style={styles.dealChip}>
                      <Text style={styles.dealChipText}>🔥 Deal of the day</Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.addedPrice}>P{addedToCart.price}</Text>
                )}
                <TouchableOpacity
                  style={[styles.addedBtn, styles.addedBtnPrimary]}
                  onPress={() => {
                    setAddedToCart(null);
                    navigation.navigate('CartTab');
                  }}
                  activeOpacity={0.85}
                  accessibilityLabel="View cart"
                  accessibilityRole="button"
                >
                  <Text style={styles.addedBtnPrimaryText}>View Cart</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addedBtn, styles.addedBtnGhost]}
                  onPress={() => setAddedToCart(null)}
                  activeOpacity={0.85}
                  accessibilityLabel="Continue shopping"
                  accessibilityRole="button"
                >
                  <Text style={styles.addedBtnGhostText}>Continue shopping</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        ) : null}
      </View>
    );
  }

  // ---- PLP: 2-column grid + search + category chips ----
  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.input}
          placeholder="Search products by name…"
          value={filter}
          onChangeText={setFilter}
          autoCapitalize="none"
        />
        {/* Scan shortcut inside the search bar (Lazada/Shopee pattern): tap to
            open the OCR scanner — a strong match auto-opens the product. */}
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => navigation.navigate('OCR')}
          accessibilityLabel="Scan a product with the camera"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="camera-outline" size={22} color={colors.brandPrimary} />
        </TouchableOpacity>
      </View>

      {/* Category chips: horizontal ScrollView (not FlatList) — FlatList rows
          collapse to ~0 height inside a plain flex View on react-native-web,
          pushing the chips into the sort row and count. Explicit height +
          centered content keeps the row stable on every platform. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipList}
        contentContainerStyle={styles.chipRow}
      >
        {/* Active group filter chip — shows the group name with an X to clear */}
        {categoryGroup.length > 0 && (
          <TouchableOpacity
            key="group"
            style={[styles.chip, styles.chipActive]}
            onPress={() => { setCategoryGroup([]); setGroupLabel(''); }}
          >
            <Text style={[styles.chipText, styles.chipTextActive]}>
              {groupLabel || 'Group'} ✕
            </Text>
          </TouchableOpacity>
        )}
        {categories.map((c) => (
          <TouchableOpacity
            key={c || 'all'}
            style={[styles.chip, category === c && !categoryGroup.length && styles.chipActive]}
            onPress={() => { setCategory(c); setCategoryGroup([]); setGroupLabel(''); }}
          >
            <Text style={[styles.chipText, category === c && !categoryGroup.length && styles.chipTextActive]}>
              {c || 'All'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sort row + live result count (Shopee-style catalog toolbar).
          Horizontal ScrollView so the 4 chips never clip on narrow phones;
          explicit height so it can't collapse into the count text. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortRow}
        contentContainerStyle={styles.sortRowContent}
      >
        {SORT_OPTIONS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.sortChip, sort === s.key && styles.sortChipActive]}
            onPress={() => setSort(s.key)}
          >
            <Text style={[styles.sortChipText, sort === s.key && styles.sortChipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.resultCount}>
        {filtered.length} product{filtered.length === 1 ? null : 's'}
        {categoryGroup.length > 0 && groupLabel ? ` in ${groupLabel}` : category ? ` in ${category}` : null}
      </Text>

      <FlatList
        data={filtered}
        numColumns={2}
        style={styles.gridList}
        keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        columnWrapperStyle={styles.rowWrap}
        contentContainerStyle={styles.listContent}          renderItem={({ item, index }) => {
          const cardDeal = pickIds.has(Number(item.id)) ? dealPricing(item) : null;
          return (
            <AnimatedEntry delay={Math.min(index * 60, 480)} preset="pop" duration={350}>
            <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} accessibilityLabel={`${item.name}, ${item.category}, P${item.price}`} accessibilityRole="button">
              <View style={styles.cardTop}>
                {item.image ? (
                  <Image source={{ uri: imageUrl(item.image) }} style={styles.cardImage} resizeMode="cover" />
                ) : null}
                {/* Quick-add (+) corner button, Shopee-style: adds without
                    leaving the grid. Guests get the login gate instead. */}
                <TouchableOpacity
                  style={styles.quickAdd}
                  onPress={() =>
                    requireLogin(() => {
                      addItem(item, 1, cardDeal ? cardDeal.deal : undefined, cardDeal ? cardDeal.original : undefined);
                      showToast('Added to cart', {
                        actionLabel: 'View',
                        onAction: () => navigation.navigate('CartTab'),
                      });
                    })
                  }
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityLabel={`Add ${item.name} to cart`}
                  accessibilityRole="button"
                >
                  <Text style={styles.quickAddText}>+</Text>
                </TouchableOpacity>
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>{item.category}</Text>
              {/* Today's picks show the flash deal price right on the card, so
                  the grid previews what the detail page will charge. */}
              {cardDeal ? (
                <DealPrice deal={cardDeal} styles={styles} />
              ) : (
                <Text style={styles.cardPrice}>P{item.price}</Text>
              )}
              <Text style={styles.cardRating}>★ {productRating(item).rating}</Text>
            </TouchableOpacity>
            </AnimatedEntry>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No products found.</Text>}
      />
      {gateModal}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  searchWrap: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  input: { flex: 1, backgroundColor: colors.surface, padding: 12, paddingRight: 44, borderRadius: 10, color: colors.textPrimary, fontSize: 15 },
  scanBtn: { position: 'absolute', right: 6, padding: 6 },
  // Explicit height (>= 40px tap target) + centered chips — the row can never
  // collapse into the sort row / count text on any platform or width.
  chipList: { flexGrow: 0, flexShrink: 0, height: 42, marginBottom: 4 },
  chipRow: { alignItems: 'center', paddingRight: 8 },
  chip: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  sortRow: { flexGrow: 0, flexShrink: 0, height: 36, marginBottom: 8 },
  sortRowContent: { alignItems: 'center' },
  sortChip: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  sortChipActive: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  sortChipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  sortChipTextActive: { color: '#fff' },
  resultCount: { fontSize: 12, color: colors.textSecondary, marginBottom: 10 },
  gridList: { flex: 1 },
  rowWrap: { justifyContent: 'space-between' },
  listContent: { paddingBottom: 24 },
  card: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTop: { minHeight: 42 },
  cardImage: { width: '100%', height: 90, borderRadius: 8, marginBottom: 8, backgroundColor: colors.background },
  cardName: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
  cardMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  cardPrice: { color: colors.brandPrimary, fontWeight: '800', fontSize: 15, marginTop: 8 },
  empty: { marginTop: 24, textAlign: 'center', color: colors.textSecondary },
  cardRating: { color: '#f5a623', fontSize: 12, fontWeight: '700', marginTop: 2 },
  // ---- Deal-of-the-day price row (shared PDP / PLP / cross-sell) ----
  dealRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8, flexWrap: 'wrap' },
  dealPrice: { fontSize: 15, fontWeight: '800', color: '#e23744' },
  // Large (PDP) variant: bigger type but NO extra top margin — dealRow already
  // carries the spacing, so the PDP row doesn't double-pad.
  dealPriceLg: { fontSize: 24, fontWeight: '800', color: '#e23744' },
  dealOriginal: { fontSize: 11, color: '#9aa0a6', textDecorationLine: 'line-through', marginLeft: 6 },
  dealOff: { fontSize: 10, fontWeight: '800', color: '#e23744', marginLeft: 4 },
  dealChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#ffe3dd',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  dealChipText: { fontSize: 10, fontWeight: '800', color: '#e23744', letterSpacing: 0.3 },
  addedDealWrap: { alignItems: 'center', marginTop: 6, marginBottom: 16 },
  skelSearch: { height: 44, borderRadius: 10, backgroundColor: colors.surface, marginBottom: 10 },
  skelChips: { height: 30, borderRadius: 15, backgroundColor: colors.surface, marginBottom: 14, width: '55%' },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  skelCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  skelImage: { height: 90, borderRadius: 8, backgroundColor: colors.background, marginBottom: 10 },
  skelLine: { height: 12, borderRadius: 6, backgroundColor: colors.background, marginBottom: 8, width: '80%' },
  skelLineShort: { height: 12, borderRadius: 6, backgroundColor: colors.background, width: '45%' },
  pdp: { flex: 1 },
  pdpContent: { paddingBottom: 8 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  ratingStars: { color: '#f5a623', fontSize: 15, letterSpacing: 1 },
  ratingText: { color: colors.textSecondary, fontSize: 12, marginLeft: 6 },
  sellerRow: {
    marginTop: 10,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  sellerText: { color: colors.brandPrimary, fontSize: 11, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  moqPill: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  moqText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  stockPill: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.surface,
  },
  stockText: { fontSize: 12, fontWeight: '700' },
  tierCard: {
    marginTop: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    padding: 12,
  },
  tierTitle: { fontWeight: '800', color: colors.textPrimary, fontSize: 13, marginBottom: 8 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  tierLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  tierSave: { color: colors.brandSecondary, fontWeight: '800', fontSize: 12 },
  tierPrice: { color: colors.brandPrimary, fontWeight: '700', fontSize: 13 },
  simSection: { marginTop: 18 },
  simTitle: { fontWeight: '800', color: colors.textPrimary, fontSize: 15, marginBottom: 10 },
  simCard: {
    width: 130,
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 8,
    marginRight: 10,
  },
  simImage: { width: '100%', height: 84, borderRadius: 8, backgroundColor: colors.surface },
  simName: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6 },
  simPrice: { color: colors.brandPrimary, fontSize: 13, fontWeight: '800', marginTop: 4 },
  simAdd: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simAddText: { color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 20 },
  backLink: { paddingVertical: 10 },
  backText: { color: colors.info, fontSize: 15, fontWeight: '600' },
  detailCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 20 },
  detailImage: { width: '100%', height: 180, borderRadius: 12, marginBottom: 12, backgroundColor: colors.background },
  detailTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  detailCategory: { color: colors.textSecondary, marginTop: 4 },
  detailPrice: { fontSize: 24, fontWeight: '800', color: colors.brandPrimary, marginTop: 10, marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  detailLabel: { color: colors.textSecondary, fontWeight: '500' },
  detailDesc: { marginTop: 12, color: colors.textSecondary, lineHeight: 20 },
  locCard: { marginTop: 14, backgroundColor: colors.background, borderRadius: 10, padding: 12 },
  locTitle: { fontWeight: '700', color: colors.textPrimary, fontSize: 13, marginBottom: 8 },
  locRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  locName: { color: colors.textSecondary, fontSize: 13 },
  locQty: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  locQtyZero: { color: colors.error },
  locEmpty: { color: colors.textSecondary, fontSize: 12 },
  stickyBar: {
    backgroundColor: colors.surface,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    flexDirection: 'row',
    gap: 10,
  },
  addCartBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addCartBtnText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
  stickyBtn: { flex: 1.4, backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  stickyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  quickAdd: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  quickAddText: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 24 },
  addedBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  addedCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  addedGlyph: { fontSize: 34, marginBottom: 8 },
  addedTitle: { fontSize: 19, fontWeight: '800', color: colors.textPrimary },
  addedName: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
  addedPrice: { fontSize: 18, fontWeight: '800', color: colors.brandPrimary, marginTop: 6, marginBottom: 16 },
  addedBtn: { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  addedBtnPrimary: { backgroundColor: colors.brandPrimary },
  addedBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  addedBtnGhost: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brandPrimary },
  addedBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

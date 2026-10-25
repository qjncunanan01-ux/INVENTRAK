import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { getInventory, imageUrl, listAllProducts } from '../../api';
import { useCart } from '../../cart-context';
import { MODAL_ANIMATION } from '../../Dialog';
import { useLoginGate } from '../../login-gate';
import { showToast } from '../../toast';
import {
  productTitle,
  similarProducts,
  stockMapFromInventory,
  stockStatus,
} from '../../product-enrichment';
import { useThemeColors } from '../../theme-context';
import AnimatedEntry from '../../AnimatedEntry';

const SORT_OPTIONS = [
  { key: 'default', label: 'Default' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'priceAsc', label: 'Price ↑' },
  { key: 'priceDesc', label: 'Price ↓' },
];

// Tiny stock-status pill for the catalog grid cards: green In stock, amber
// Low stock, red Out of stock (same <25 threshold as the PDP + carousel).
// Missing stock data shows nothing (stock feed not loaded yet) rather than a
// misleading badge.
function StockPill({ total, styles, colors }) {
  if (total === undefined || total === null) return null;
  const status = stockStatus(total);
  const color =
    status.tone === 'out' ? colors.error : status.tone === 'low' ? colors.warning : colors.success;
  return (
    <View style={[styles.stockPillSm, { borderColor: color }]} accessibilityLabel={`${status.label}`}>
      <Text style={[styles.stockPillSmText, { color }]}>{status.label}</Text>
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
  // Live per-product total stock (productId -> units) from /api/inventory —
  // powers the In stock / Low stock / Out of stock pills on the grid cards.
  const [stockMap, setStockMap] = useState({});
  // Scroll the PDP back to the top whenever the open product changes (a
  // cross-sell tap would otherwise keep the old scroll offset mid-detail).
  const scrollRef = useRef(null);
  const { items: cartItems, addItem } = useCart();
  // Guests cannot add to cart — every add affordance routes through this gate.
  const { requireLogin, gateModal } = useLoginGate(navigation);
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const tryAddItem = (product) => {
    const available = stockMap[Number(product && product.id)];
    if (!Number.isFinite(Number(available))) {
      showToast('Stock is still loading. Refresh and try again.');
      return false;
    }
    const currentQty = cartItems.find((entry) => Number(entry.product.id) === Number(product.id))?.qty || 0;
    if (available < currentQty + 1) {
      showToast(available <= 0 ? 'This item is out of stock.' : `Only ${available} unit(s) are available.`);
      return false;
    }
    if (!addItem(product, 1, available)) {
      showToast('The cart is loading or has reached its order limit. Please try again.');
      return false;
    }
    return true;
  };

  const fetchProducts = useCallback(async() => {
    try {
      const [items, inv] = await Promise.all([
        listAllProducts(),
        getInventory().catch(() => null),
      ]);
      setProducts(items);
      setStockMap(stockMapFromInventory(inv));
    } catch (err) {
      showToast('Failed to load products. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Deep-link focus: when Home (quick tile) navigates here with focusId, open
  // that product's PDP after the catalog loads. Consumed once per navigation,
  // so closing the PDP clears the param and it can be opened again later.
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
    [selected, products],
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
    [products],
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
  }, [products, filter, category, categoryGroup, groupLabel, sort]);

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
    const description = String(selected.description || '').trim();
    const totalStock = locStock
      ? Object.keys(locStock.item.locations || {}).reduce(
        (s, k) => s + (Number(locStock.item.locations[k]) || 0),
        0,
      )
      : undefined;
    const status = stockStatus(totalStock);
    const stockColor =
      status.tone === 'out' ? colors.error : status.tone === 'low' ? colors.warning : colors.success;

    return (
      <View style={styles.container}>
        <ScrollView ref={scrollRef} style={styles.pdp} contentContainerStyle={styles.pdpContent}>
          <TouchableOpacity onPress={closePdp} style={styles.backLink} accessibilityLabel="Go back to products" accessibilityRole="button">
            <Text style={styles.backText}>{'< Back to products'}</Text>
          </TouchableOpacity>

          <View style={styles.detailCard}>
            {selected.image ? (
              <Image source={{ uri: imageUrl(selected.image) }} style={styles.detailImage} resizeMode="contain" />
            ) : null}
            <Text style={styles.detailTitle}>{productTitle(selected)}</Text>
            <Text style={styles.detailCategory}>{selected.category}</Text>

            <Text style={styles.detailPrice}>₱{Number(selected.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>

            <View style={styles.sellerRow}>
              <Text style={styles.sellerText}>Supplied by Sylver Restaurant and Coffee Supplies</Text>
            </View>

            {description ? <Text style={styles.detailDesc}>{description}</Text> : null}

            <View style={styles.detailRow}><Text style={styles.detailLabel}>Brand:</Text><Text>{selected.brand || '-'}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Size:</Text><Text>{selected.size || '-'}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Unit:</Text><Text>{selected.unit || 'pcs'}</Text></View>

            <View style={styles.metaRow}>
              {totalStock !== undefined ? (
                <View style={[styles.stockPill, { borderColor: stockColor }]}>
                  <Text style={[styles.stockText, { color: stockColor }]}>
                    {status.label} · {totalStock} in stock
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Multi-location availability */}
            <View style={styles.locCard}>
              <Text style={styles.locTitle}>Available stock by location</Text>
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

            {/* Related items are based on shared product details, not order history. */}
            {sim.length > 0 ? (
              <View style={styles.simSection}>
                <Text style={styles.simTitle}>Similar items</Text>
                <FlatList
                  horizontal
                  data={sim}
                  keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.simCard} onPress={() => setSelected(item)}>
                      {item.image ? (
                        <Image source={{ uri: imageUrl(item.image) }} style={styles.simImage} resizeMode="contain" />
                      ) : null}
                      <Text style={styles.simName} numberOfLines={2}>{productTitle(item)}</Text>
                      <Text style={styles.simPrice}>₱{Number(item.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                      <TouchableOpacity
                        style={styles.simAdd}
                        onPress={() =>
                          requireLogin(() => {
                            if (!tryAddItem(item)) return;
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
                  )}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>

        <View style={styles.stickyBar}>
          <TouchableOpacity
            style={styles.addCartBtn}
            onPress={() =>
              requireLogin(() => {
                if (!tryAddItem(selected)) return;
                setAddedToCart(selected);
              })
            }
            accessibilityLabel="Add to cart"
            accessibilityRole="button"
          >
            <Text style={styles.addCartBtnText}>Add to Cart</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stickyBtn}
            onPress={() =>
              requireLogin(() => {
                if (!tryAddItem(selected)) return;
                navigation.navigate('OrdersTab', {
                  screen: 'OrderInquiry',
                  params: { preselectId: selected.id },
                });
              })
            }
            accessibilityLabel="Request a quote"
            accessibilityRole="button"
          >
            <Text style={styles.stickyBtnText}>Request a quote</Text>
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
                <Text style={styles.addedName} numberOfLines={2}>{productTitle(addedToCart)}</Text>
                <Text style={styles.addedPrice}>₱{Number(addedToCart.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
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
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => (
          <AnimatedEntry delay={Math.min(index * 60, 480)} preset="pop" duration={350} style={styles.gridCell}>
            <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} accessibilityLabel={`${item.name}, ${item.category}, ₱${item.price}`} accessibilityRole="button">
              <View style={styles.cardTop}>
                {item.image ? (
                  <Image source={{ uri: imageUrl(item.image) }} style={styles.cardImage} resizeMode="contain" />
                ) : null}
                {/* Quick-add (+) corner button, Shopee-style: adds without
                    leaving the grid. Guests get the login gate instead. */}
                <TouchableOpacity
                  style={styles.quickAdd}
                  onPress={() =>
                    requireLogin(() => {
                      if (!tryAddItem(item)) return;
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
                <Text style={styles.cardName} numberOfLines={2}>{productTitle(item)}</Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>{item.category}</Text>
              <Text style={styles.cardPrice}>₱{Number(item.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
              <StockPill total={stockMap[Number(item.id)]} styles={styles} colors={colors} />
            </TouchableOpacity>
          </AnimatedEntry>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No products found.</Text>}
      />
      {gateModal}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, padding: 16 },
  searchWrap: { alignItems: 'center', flexDirection: 'row', marginBottom: 10 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.textPrimary, flex: 1, fontSize: 15, minHeight: 48, paddingHorizontal: 14 },
  // Explicit height (>= 40px tap target) + centered chips — the row can never
  // collapse into the sort row / count text on any platform or width.
  chipList: { flexGrow: 0, flexShrink: 0, height: 52, marginBottom: 4 },
  chipRow: { alignItems: 'center', paddingRight: 8 },
  chip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, justifyContent: 'center', marginRight: 8, minHeight: 48, paddingHorizontal: 14 },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  sortRow: { flexGrow: 0, flexShrink: 0, height: 52, marginBottom: 8 },
  sortRowContent: { alignItems: 'center' },
  sortChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    marginRight: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sortChipActive: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  sortChipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  sortChipTextActive: { color: '#fff' },
  resultCount: { color: colors.textSecondary, fontSize: 12, marginBottom: 10 },
  gridList: { flex: 1 },
  // New-arch (Fabric) FlatList rows don't give children a definite width, so
  // percentage card widths collapse to content size. Full-width row + gap +
  // flex:1 cells renders two equal columns on both old and new architecture.
  rowWrap: { gap: 12, width: '100%' },
  gridCell: { flex: 1 },
  listContent: { paddingBottom: 24 },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 1,
    marginBottom: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardTop: { minHeight: 42 },
  // White tile + 'contain' (Shopee/Lazada pattern): product photos are shot
  // on white, so letterboxing blends invisibly and every product renders at
  // the same visual size. 'cover' zoom-crops each photo differently, which
  // read as misaligned/overlapping images in the grid.
  cardImage: { backgroundColor: '#ffffff', borderRadius: 10, height: 116, marginBottom: 10, width: '100%' },
  cardName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  cardMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  cardPrice: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800', marginTop: 8 },
  empty: { color: colors.textSecondary, marginTop: 24, textAlign: 'center' },
  stockPillSm: { alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1, marginTop: 8, paddingHorizontal: 8, paddingVertical: 4 },
  stockPillSmText: { fontSize: 10, fontWeight: '800' },
  skelSearch: { backgroundColor: colors.surface, borderRadius: 10, height: 44, marginBottom: 10 },
  skelChips: { backgroundColor: colors.surface, borderRadius: 15, height: 30, marginBottom: 14, width: '55%' },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  skelCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 12,
    padding: 12,
    width: '48%',
  },
  skelImage: { backgroundColor: colors.background, borderRadius: 8, height: 90, marginBottom: 10 },
  skelLine: { backgroundColor: colors.background, borderRadius: 6, height: 12, marginBottom: 8, width: '80%' },
  skelLineShort: { backgroundColor: colors.background, borderRadius: 6, height: 12, width: '45%' },
  pdp: { flex: 1 },
  pdpContent: { paddingBottom: 8 },
  sellerRow: {
    alignSelf: 'flex-start',
    backgroundColor: colors.background,
    borderRadius: 8,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sellerText: { color: colors.brandPrimary, fontSize: 11, fontWeight: '600' },
  metaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  stockPill: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  stockText: { fontSize: 12, fontWeight: '700' },
  simSection: { marginTop: 18 },
  simTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 10 },
  simCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    marginRight: 10,
    padding: 8,
    width: 142,
  },
  simImage: { backgroundColor: '#ffffff', borderRadius: 8, height: 90, width: '100%' },
  simName: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6 },
  simPrice: { color: colors.brandPrimary, fontSize: 13, fontWeight: '800', marginTop: 4 },
  simAdd: {
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 48,
  },
  simAddText: { color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 20 },
  backLink: { paddingVertical: 10 },
  backText: { color: colors.info, fontSize: 15, fontWeight: '600' },
  detailCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 20 },
  detailImage: { backgroundColor: '#ffffff', borderRadius: 12, height: 180, marginBottom: 12, width: '100%' },
  detailTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  detailCategory: { color: colors.textSecondary, marginTop: 4 },
  detailPrice: { color: colors.brandPrimary, fontSize: 24, fontWeight: '800', marginBottom: 12, marginTop: 10 },
  detailRow: { borderBottomColor: 'rgba(0,0,0,0.05)', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  detailLabel: { color: colors.textSecondary, fontWeight: '500' },
  detailDesc: { color: colors.textSecondary, lineHeight: 20, marginTop: 12 },
  locCard: { backgroundColor: colors.background, borderRadius: 10, marginTop: 14, padding: 12 },
  locTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  locRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  locName: { color: colors.textSecondary, fontSize: 13 },
  locQty: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  locQtyZero: { color: colors.error },
  locEmpty: { color: colors.textSecondary, fontSize: 12 },
  stickyBar: {
    backgroundColor: colors.surface,
    borderTopColor: 'rgba(0,0,0,0.06)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  addCartBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.brandPrimary,
    borderRadius: 12,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
  },
  addCartBtnText: { color: colors.brandPrimary, fontSize: 14, fontWeight: '800' },
  stickyBtn: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 12, flex: 1.4, justifyContent: 'center', minHeight: 48, paddingVertical: 12 },
  stickyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  quickAdd: {
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    elevation: 3,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    top: 4,
    width: 48,
  },
  quickAddText: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 24 },
  addedBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  addedCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    maxWidth: 380,
    padding: 24,
    width: '100%',
  },
  addedGlyph: { fontSize: 34, marginBottom: 8 },
  addedTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800' },
  addedName: { color: colors.textSecondary, fontSize: 14, marginTop: 8, textAlign: 'center' },
  addedPrice: { color: colors.brandPrimary, fontSize: 18, fontWeight: '800', marginBottom: 16, marginTop: 6 },
  addedBtn: { alignItems: 'center', borderRadius: 12, marginBottom: 10, paddingVertical: 14, width: '100%' },
  addedBtnPrimary: { backgroundColor: colors.brandPrimary },
  addedBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  addedBtnGhost: { backgroundColor: colors.surface, borderColor: colors.brandPrimary, borderWidth: 1.5 },
  addedBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { getInventory, imageUrl, listAllProducts, useSessionUsername } from '../../api';
import { useCart } from '../../cart-context';
import { useThemeColors } from '../../theme-context';
import Dialog from '../../Dialog';
import { productTitle } from '../../product-enrichment';
import { showToast } from '../../toast';

// The cart holds supplies and current catalog prices; checkout is an order inquiry.
export default function CartScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isLoggedIn = !!useSessionUsername(null);
  const { items, itemCount, count, hydrated, setQty, removeItem, clear } = useCart();
  const [stockById, setStockById] = useState({});
  const [catalogById, setCatalogById] = useState({});

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    Promise.all([getInventory().catch(() => null), listAllProducts().catch(() => [])]).then(([response, products]) => {
      if (cancelled) return;
      const inventory = response && response.data ? response.data : response;
      const stock = {};
      (inventory && inventory.items || []).forEach((row) => {
        if (row && row.product && row.product.id != null) stock[Number(row.product.id)] = Number(row.total) || 0;
      });
      setStockById(stock);
      const list = Array.isArray(products) ? products : Array.isArray(products?.data) ? products.data : [];
      setCatalogById(Object.fromEntries(list.map((product) => [Number(product.id), product])));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []));

  const goCheckout = () => {
    navigation.navigate('OrdersTab', { screen: 'OrderInquiry' });
  };

  const goBrowse = () => {
    navigation.navigate('CatalogTab', { screen: 'Products' });
  };

  const [confirmClear, setConfirmClear] = useState(false);

  // Gate on the provider's hydrated flag (not a timer) so a saved cart is
  // never briefly flashed as empty while AsyncStorage is still loading.
  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View></SafeAreaView>
    );
  }

  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.lockWrap}>
        <MaterialCommunityIcons name="cart-outline" size={48} color={colors.brandPrimary} style={styles.lockGlyph} />
        <Text style={styles.lockTitle}>Log in to see your cart</Text>
        <Text style={styles.lockBody}>
          Your cart is a member feature — create a free account or log in to
          build your order.
        </Text>
        <TouchableOpacity style={[styles.lockBtn, styles.lockBtnPrimary]} onPress={() => navigation.navigate('Signup')} activeOpacity={0.85}>
          <Text style={styles.lockBtnPrimaryText}>Create Account</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.lockBtn, styles.lockBtnGhost]} onPress={() => navigation.navigate('Login')} activeOpacity={0.85}>
          <Text style={styles.lockBtnGhostText}>Log In</Text>
        </TouchableOpacity>
      </View></SafeAreaView>
    );
  }

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.container}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="cart-outline" size={22} color="#fff" />
          <Text style={styles.headerTitle}>Your cart</Text>
        </View>
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons name="cart-outline" size={48} color={colors.textSecondary} style={styles.emptyGlyph} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySub}>
            Browse the catalog and tap + on any supply to build your order.
          </Text>
          <TouchableOpacity style={styles.browseBtn} onPress={goBrowse} activeOpacity={0.8}>
            <Text style={styles.browseBtnText}>Browse products</Text>
          </TouchableOpacity>
        </View>
      </View></SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.container}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="cart-outline" size={22} color="#fff" />
        <Text style={styles.headerTitle}>Your cart</Text>
        <Text style={styles.headerCount}>{count} unit{count === 1 ? '' : 's'}</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item, index) => String(item.product?.id ?? item.product?.name ?? index)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const product = catalogById[Number(item.product.id)] || item.product;
          const price = Number(product.price) || 0;
          return (
            <View style={styles.row}>
              {product.image ? (
                <Image source={{ uri: imageUrl(product.image) }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={2}>{productTitle(product)}</Text>
                <Text style={styles.meta} numberOfLines={1}>{product.category}</Text>
                {stockById[Number(item.product.id)] !== undefined && (
                  <Text style={[styles.meta, item.qty > stockById[Number(item.product.id)] && styles.stockWarning]}>
                    {stockById[Number(item.product.id)]} available
                  </Text>
                )}
                <Text style={styles.price}>₱{price.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each</Text>
              </View>
              <View style={styles.rightCol}>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setQty(item.product.id, item.qty - 1)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Decrease quantity"
                    accessibilityRole="button"
                  >
                    <Text style={styles.stepText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.qty}>{item.qty}</Text>
                  <TouchableOpacity
                    style={[
                      styles.stepBtn,
                      stockById[Number(item.product.id)] !== undefined
                        && item.qty >= stockById[Number(item.product.id)]
                        && styles.stepBtnDisabled,
                    ]}
                    disabled={stockById[Number(item.product.id)] !== undefined
                      && item.qty >= stockById[Number(item.product.id)]}
                    onPress={() => {
                      const available = stockById[Number(item.product.id)];
                      if (available === undefined) return showToast('Stock is still loading. Refresh before adding more.');
                      if (item.qty >= available) return showToast(`Only ${available} unit(s) are available.`);
                      setQty(item.product.id, item.qty + 1);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Increase quantity"
                    accessibilityRole="button"
                  >
                    <Text style={styles.stepText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.lineTotal}>₱{(price * item.qty).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                <TouchableOpacity onPress={() => removeItem(item.product.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={`Remove ${item.product.name} from cart`} accessibilityRole="button">
                  <Text style={styles.remove}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {itemCount} item{itemCount === 1 ? '' : 's'} · subtotal
          </Text>
          <Text style={styles.totalValue}>₱{items.reduce((sum, item) => sum + (Number(catalogById[Number(item.product.id)]?.price ?? item.product.price) || 0) * item.qty, 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
        </View>
        <TouchableOpacity style={styles.checkoutBtn} onPress={goCheckout} activeOpacity={0.85} accessibilityLabel="Proceed to checkout" accessibilityRole="button">
          <Text style={styles.checkoutText}>Continue to order inquiry</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goBrowse} hitSlop={{ top: 8, bottom: 8 }} accessibilityLabel="Browse more products" accessibilityRole="button">
          <Text style={styles.continue}>+ Add more supplies</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setConfirmClear(true)}
          hitSlop={{ top: 8, bottom: 8 }}
          style={styles.clearWrap}
          accessibilityLabel="Clear all items from cart"
          accessibilityRole="button"
        >
          <Text style={styles.clear}>Clear cart</Text>
        </TouchableOpacity>
      </View>

      {/* Clear-cart confirmation: the whole basket vanishes on one tap, so
          ask first (cross-platform Dialog — Alert.alert is a no-op on web). */}
      <Dialog
        visible={confirmClear}
        glyph="🗑️"
        title="Clear your cart?"
        body={`This removes all ${count} item${count === 1 ? '' : 's'} from your basket. You can add them again anytime.`}
        confirmLabel="Yes, clear cart"
        confirmDanger
        onConfirm={() => {
          setConfirmClear(false);
          clear();
        }}
        cancelLabel="Keep items"
        onCancel={() => setConfirmClear(false)}
      />
    </View>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safeArea: { backgroundColor: colors.brandPrimary, flex: 1 },
  container: { backgroundColor: colors.background, flex: 1 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  header: { alignItems: 'center', backgroundColor: colors.brandPrimary, flexDirection: 'row', gap: 10, paddingBottom: 14, paddingHorizontal: 16, paddingTop: 16 },
  headerTitle: { color: '#fff', flex: 1, fontSize: 18, fontWeight: '800' },
  headerCount: { color: '#fff', fontSize: 13, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  emptyGlyph: { marginBottom: 12 },
  emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  emptySub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  browseBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    marginTop: 20,
    paddingHorizontal: 32,
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
  },
  browseBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listContent: { padding: 16 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    elevation: 1,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  thumb: { backgroundColor: colors.background, borderRadius: 8, height: 64, width: 64 },
  thumbPlaceholder: { backgroundColor: '#e3eeda' },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  name: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  stockWarning: { color: colors.error, fontWeight: '700' },
  price: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  rightCol: { alignItems: 'flex-end', justifyContent: 'space-between' },
  stepper: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
  },
  stepBtn: { alignItems: 'center', height: 48, justifyContent: 'center', width: 44 },
  stepBtnDisabled: { opacity: 0.35 },
  stepText: { color: colors.brandPrimary, fontSize: 16, fontWeight: '700' },
  qty: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  lineTotal: { color: colors.brandPrimary, fontSize: 14, fontWeight: '800', marginTop: 6 },
  remove: { color: colors.error, fontSize: 12, marginTop: 4 },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: 'rgba(0,0,0,0.06)',
    borderTopWidth: 1,
    padding: 16,
    paddingBottom: 24,
  },
  totalRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  totalLabel: { color: colors.textSecondary, fontSize: 14 },
  totalValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  checkoutBtn: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 12, justifyContent: 'center', minHeight: 48, paddingHorizontal: 12, paddingVertical: 12 },
  checkoutText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  continue: { color: colors.brandPrimary, fontSize: 13, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  clearWrap: { alignItems: 'center', marginTop: 6 },
  clear: { color: colors.error, fontSize: 12 },
  // Background is required: without it the browser's white page shows
  // through in dark mode and textPrimary (white) becomes unreadable.
  lockWrap: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: 28 },
  lockGlyph: { marginBottom: 12 },
  lockTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  lockBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  lockBtn: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', marginBottom: 10, maxWidth: 320, minHeight: 48, paddingVertical: 12, width: '100%' },
  lockBtnPrimary: { backgroundColor: colors.brandPrimary },
  lockBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  lockBtnGhost: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  lockBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

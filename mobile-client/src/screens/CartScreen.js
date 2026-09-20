import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { imageUrl, useSessionUsername } from '../api';
import { useCart } from '../cart-context';
import { useThemeColors } from '../theme-context';
import Dialog from '../Dialog';

// Shopping cart screen (Shopee/Lazada pattern): line items with steppers,
// swipe-free remove, live subtotal, and a single "Proceed to Checkout" CTA.
// Member-only: the tab is hidden for guests in App.js; this lock screen is
// the defensive backstop (e.g. a logout while the tab is still mounted).
export default function CartScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isLoggedIn = !!useSessionUsername(null);
  const { items, subtotal, itemCount, count, hydrated, setQty, removeItem, clear } = useCart();

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
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.lockWrap}>
        <Text style={styles.lockGlyph}>🛒</Text>
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
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.brand}>INVENTRAK</Text>
          <Text style={styles.headerTitle}>🛒 Cart</Text>
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyGlyph}>🛒</Text>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySub}>
            Browse the catalog and tap + on any supply to build your order.
          </Text>
          <TouchableOpacity style={styles.browseBtn} onPress={goBrowse} activeOpacity={0.8}>
            <Text style={styles.browseBtnText}>Browse products</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>INVENTRAK</Text>
        <Text style={styles.headerTitle}>🛒 Cart ({count})</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item, index) => String(item.product?.id ?? item.product?.name ?? index)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.product.image ? (
              <Image source={{ uri: imageUrl(item.product.image) }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>{item.product.name}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.product.category}</Text>
              <Text style={styles.price}>P{(Number(item.price) > 0 ? item.price : item.product.price)} each</Text>
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
                  style={styles.stepBtn}
                  onPress={() => setQty(item.product.id, item.qty + 1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Increase quantity"
                  accessibilityRole="button"
                >
                  <Text style={styles.stepText}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.lineTotal}>P{((Number(item.price) > 0 ? Number(item.price) : Number(item.product.price) || 0) * item.qty).toFixed(2)}</Text>
              <TouchableOpacity onPress={() => removeItem(item.product.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={`Remove ${item.product.name} from cart`} accessibilityRole="button">
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            {itemCount} item{itemCount === 1 ? '' : 's'} · subtotal
          </Text>
          <Text style={styles.totalValue}>P{subtotal.toFixed(2)}</Text>
        </View>
        <TouchableOpacity style={styles.checkoutBtn} onPress={goCheckout} activeOpacity={0.85} accessibilityLabel="Proceed to checkout" accessibilityRole="button">
          <Text style={styles.checkoutText}>Proceed to Checkout</Text>
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
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  header: {
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: 16,
    paddingTop: 56,
  },
  brand: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  emptyGlyph: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  emptySub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  browseBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    marginTop: 20,
    paddingHorizontal: 32,
    paddingVertical: 14,
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
  stepBtn: { paddingHorizontal: 10, paddingVertical: 6 },
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
  checkoutBtn: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 15 },
  checkoutText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  continue: { color: colors.brandPrimary, fontSize: 13, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  clearWrap: { alignItems: 'center', marginTop: 6 },
  clear: { color: colors.error, fontSize: 12 },
  // Background is required: without it the browser's white page shows
  // through in dark mode and textPrimary (white) becomes unreadable.
  lockWrap: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: 28 },
  lockGlyph: { fontSize: 44, marginBottom: 12 },
  lockTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  lockBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  lockBtn: { alignItems: 'center', borderRadius: 12, marginBottom: 10, maxWidth: 320, paddingVertical: 14, width: '100%' },
  lockBtnPrimary: { backgroundColor: colors.brandPrimary },
  lockBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  lockBtnGhost: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  lockBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

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
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    backgroundColor: colors.brandPrimary,
  },
  brand: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyGlyph: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  emptySub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  browseBtn: {
    marginTop: 20,
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  browseBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listContent: { padding: 16 },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.background },
  thumbPlaceholder: { backgroundColor: '#e3eeda' },
  info: { flex: 1, marginLeft: 12, marginRight: 8 },
  name: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  price: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  rightCol: { alignItems: 'flex-end', justifyContent: 'space-between' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  stepText: { fontSize: 16, fontWeight: '700', color: colors.brandPrimary },
  qty: { minWidth: 28, textAlign: 'center', fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
  lineTotal: { color: colors.brandPrimary, fontWeight: '800', fontSize: 14, marginTop: 6 },
  remove: { color: colors.error, fontSize: 12, marginTop: 4 },
  footer: {
    backgroundColor: colors.surface,
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  totalLabel: { fontSize: 14, color: colors.textSecondary },
  totalValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  checkoutBtn: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  checkoutText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  continue: { color: colors.brandPrimary, fontWeight: '600', fontSize: 13, textAlign: 'center', marginTop: 12 },
  clearWrap: { alignItems: 'center', marginTop: 6 },
  clear: { color: colors.error, fontSize: 12 },
  lockWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  lockGlyph: { fontSize: 44, marginBottom: 12 },
  lockTitle: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  lockBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  lockBtn: { width: '100%', maxWidth: 320, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  lockBtnPrimary: { backgroundColor: colors.brandPrimary },
  lockBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  lockBtnGhost: { borderWidth: 1.5, borderColor: colors.brandPrimary },
  lockBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Button, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createOrderInquiry, getInventory, getMe, imageUrl, listAllProducts, useSessionUsername } from '../../api';
import { useCart } from '../../cart-context';
import { useThemeColors } from '../../theme-context';
import Dialog, { MODAL_ANIMATION } from '../../Dialog';
import { ORDER_TERMS, ORDER_TERMS_VERSION } from '../../order-terms';
import { showToast } from '../../toast';
import { productTitle } from '../../product-enrichment';

// How the order is received. A PREFERENCE, not a courier booking: the business
// arranges delivery; nothing here promises a window or a live tracker.
const FULFILLMENT_METHODS = [
  { id: 'pickup', label: 'Pickup', hint: 'Collect at the store' },
  { id: 'courier', label: 'Courier', hint: 'Deliver to my address' },
];

const PAYMENT_METHODS = [
  { id: 'cod', label: 'COD', hint: 'Cash on delivery' },
  { id: 'gcash', label: 'GCash', hint: 'Pay via GCash' },
  { id: 'card', label: 'Card', hint: 'Credit / debit card' },
];

export default function OrderInquiryScreen({ route, navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The checkout reads from the SHARED cart (Shopee/Lazada pattern): the cart
  // is filled by Add-to-Cart on product cards / PDP, and here the customer
  // adjusts quantities, adds more supplies, or removes lines before placing.
  const preselectId = route.params?.preselectId;
  const bundleIds = route.params?.bundleIds;
  const { items, subtotal, itemCount, addItem, setQty, removeItem, clear } = useCart();

  // Guests can fill the whole form, but must log in / create an account to
  // actually submit — the account is only required at the point of buying.
  const sessionUser = useSessionUsername(null);
  const isLoggedIn = !!sessionUser;
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  // Pickup is the default: it is the one option that needs no address, so a
  // customer who does not think about it still ends up with a complete order.
  const [fulfillment, setFulfillment] = useState('pickup');
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  // Cross-platform feedback (Alert.alert is a no-op on RN-web): validation
  // and order-success confirmations use the shared Dialog instead.
  const [errorMsg, setErrorMsg] = useState('');
  const [showError, setShowError] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successInfo, setSuccessInfo] = useState({ count: 0, method: '' });
  // Cross-platform account gate: an in-app Modal instead of Alert.alert so it
  // renders identically on native AND on the react-native-web preview.
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState([]);
  const [stockById, setStockById] = useState({});
  const [stockLoaded, setStockLoaded] = useState(false);

  // The catalog is fetched ONLY to resolve deep-link ids (a product detail
  // page or the recommendation bundle) into cart entries — not rendered.
  // listAllProducts pages past the 100-row clamp so ids beyond the first
  // page (e.g. a recommendation bundle deep-link) still resolve.
  const fetchCatalog = useCallback(async() => {
    try {
      const [data, inventoryResponse] = await Promise.all([
        listAllProducts(),
        getInventory().catch(() => null),
      ]);
      setCatalog(data.data || (Array.isArray(data) ? data : []));
      const inventory = inventoryResponse && inventoryResponse.data ? inventoryResponse.data : inventoryResponse;
      const stock = {};
      (inventory && inventory.items || []).forEach((row) => {
        if (row && row.product && row.product.id != null) stock[Number(row.product.id)] = Number(row.total) || 0;
      });
      setStockById(stock);
    } catch (err) {
      // Catalog is optional here; the cart may already hold everything.
    } finally {
      setStockLoaded(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  // Deep links add to the cart exactly ONCE per link (a refresh or a second
  // visit must not re-add after the customer edited their quantities).
  const prefilledRef = useRef(null);
  // Live set of cart product ids, used to skip products the deep link already
  // added (e.g. "Buy Now" pre-adds from the PDP before navigating here).
  const cartIdsRef = useRef(new Set());
  useEffect(() => {
    cartIdsRef.current = new Set(items.map((i) => Number(i.product.id)));
  }, [items]);

  useEffect(() => {
    // Adding to the cart is member-only: a guest who lands here via a stale
    // deep-link must NOT get items added to a basket they can't keep.
    if (!isLoggedIn || catalog.length === 0 || !stockLoaded) return;
    const key = bundleIds ? 'bundle:' + bundleIds.join(',') : preselectId ? 'single:' + preselectId : null;
    if (!key || prefilledRef.current === key) return;
    prefilledRef.current = key;
    const addOnce = (p) => {
      // Never double-count: "Buy Now" already added the item on the PDP, and
      // a re-entry to this screen must not re-add an item the customer edited.
      if (!p || cartIdsRef.current.has(Number(p.id))) return;
      const stock = stockById[Number(p.id)];
      if (stock === undefined) {
        showToast('Could not check stock. Refresh before adding this item.');
        return;
      }
      if (stock !== undefined && stock < 1) {
        showToast(`${p.name} is out of stock and was not added`);
        return;
      }
      addItem(p, 1);
      cartIdsRef.current.add(Number(p.id));
    };
    if (bundleIds) {
      bundleIds.forEach((id) => addOnce(catalog.find((c) => Number(c.id) === Number(id))));
    } else if (preselectId) {
      addOnce(catalog.find((c) => Number(c.id) === Number(preselectId)));
    }
  }, [preselectId, bundleIds, catalog, isLoggedIn, stockById, stockLoaded]);

  // Logged-in customers get their account details prefilled (name, email and
  // the mobile number from their profile) — no re-typing at checkout. Keyed on
  // the session username so switching accounts re-prefills for the new user.
  const [prefilledFor, setPrefilledFor] = useState(null);
  useEffect(() => {
    if (isLoggedIn && sessionUser && prefilledFor !== sessionUser) {
      setPrefilledFor(sessionUser);
      getMe()
        .then((me) => {
          if (me && me.username) setCustomerName((prev) => prev || me.username);
          if (me && me.email) setCustomerEmail((prev) => prev || me.email);
          if (me && me.phone) setCustomerPhone((prev) => prev || me.phone);
        })
        .catch(() => {});
    }
  }, [isLoggedIn, sessionUser, prefilledFor]);

  const selectedItems = useMemo(
    () => items.map((i) => {
      // Unit price: the deal snapshot when added as a flash pick, else the
      // catalog price — so the checkout total matches what the customer saw.
      const price = Number(i.price) > 0 ? Number(i.price) : Number(i.product.price) || 0;
      // Pre-discount price for deal items (snapshotted at add-to-cart), so the
      // order record carries the discount applied. Omitted for non-deals.
      const original = Number(i.original_price) > 0 ? Number(i.original_price) : null;
      return {
        id: i.product.id,
        name: productTitle(i.product),
        qty: i.qty,
        price,
        original_price: original !== null && original > price ? original : null,
        // Line total (what the customer is charged for this line).
        subtotal: Math.round(price * i.qty * 100) / 100,
      };
    }),
    [items],
  );

  const estimatedCost = subtotal;

  const submit = async() => {
    // Checkout gate: buying requires an account (browsing does not).
    if (!isLoggedIn) {
      setShowAuthGate(true);
      return;
    }
    if (!customerName.trim()) {
      setErrorMsg('Please enter your name');
      setShowError(true);
      return;
    }
    if (customerName.trim().length < 2 || customerName.trim().length > 100) {
      setErrorMsg('Name must be between 2 and 100 characters');
      setShowError(true);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      setErrorMsg('Enter a valid email address');
      setShowError(true);
      return;
    }
    if (selectedItems.length === 0) {
      setErrorMsg('Your cart is empty — add supplies first');
      setShowError(true);
      return;
    }
    // Only a courier order needs an address. Pickup collects at the store, so
    // demanding one there would block a valid order (and the backend agrees —
    // it refuses courier-without-address, not pickup-without-address).
    if (fulfillment === 'courier' && !deliveryAddress.trim()) {
      setErrorMsg('Please enter the delivery address for courier delivery');
      setShowError(true);
      return;
    }
    if (fulfillment === 'courier' && deliveryAddress.trim().length > 500) {
      setErrorMsg('Delivery address must be 500 characters or fewer');
      setShowError(true);
      return;
    }
    if (notes.length > 1000) {
      setErrorMsg('Notes must be 1000 characters or fewer');
      setShowError(true);
      return;
    }
    if (!termsAccepted) {
      setErrorMsg('Please review and accept the ordering terms before placing your order');
      setShowError(true);
      return;
    }
    const unavailable = selectedItems.find((item) => {
      const available = stockById[Number(item.id)];
      return available !== undefined && item.qty > available;
    });
    if (unavailable) {
      setErrorMsg(`Only ${stockById[Number(unavailable.id)]} unit(s) of ${unavailable.name} are currently available. Update your cart and try again.`);
      setShowError(true);
      return;
    }
    setSubmitting(true);
    try {
      const created = await createOrderInquiry({
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone.trim() || null,
        // Structured line items: name + qty + the unit price actually charged
        // (the deal price for today's picks) + the pre-discount original — the
        // backend stores these verbatim so the admin sees the discount applied
        // and the total matches the customer's bill.
        products: selectedItems.map((item) => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          price: item.price,
          ...(item.original_price ? { original_price: item.original_price } : {}),
        })),
        estimated_cost: estimatedCost,
        notes,
        // Fulfilment preference (Part 11). Pickup sends no address at all —
        // sending a stale one from a previous courier attempt would record a
        // delivery the customer did not ask for.
        fulfillment_method: fulfillment,
        ...(fulfillment === 'courier' ? { delivery_address: deliveryAddress.trim() } : {}),
        payment_method: paymentMethod,
        terms_accepted: true,
        terms_version: ORDER_TERMS_VERSION,
      });
      setMessage('Order placed successfully!');
      // Snapshot what was ordered BEFORE clearing — the success dialog renders
      // after clear() so a live selectedItems.length would read 0.
      const orderedCount = selectedItems.length;
      const orderedMethod = paymentMethod.toUpperCase();
      // The basket is spent — clear it so the next checkout starts fresh.
      clear();
      setNotes('');
      setDeliveryAddress('');

      // GCash/Card checkout now has a real payment step: the backend returns a
      // payment reference + QR (and a PayMongo checkout URL when configured).
      // Lead the customer there to actually pay, Shopee-style.
      const payment = created && created.payment;
      if (payment && ['card', 'gcash'].includes(payment.payment_method)) {
        navigation.navigate('Payment', {
          inquiryId: created.id,
          payment: {
            payment_method: payment.payment_method || paymentMethod,
            payment_reference: payment.payment_reference,
            payment_url: payment.payment_url,
            payment_qr: payment.payment_qr,
            payment_provider: payment.payment_provider,
          },
        });
        return;
      }

      // Success confirmation (cross-platform dialog — renders on web too).
      setSuccessInfo({ count: orderedCount, method: orderedMethod });
      setShowSuccess(true);
    } catch (err) {
      setMessage('Failed to submit inquiry.');
      setErrorMsg(err.message || 'Could not place your order. Please try again.');
      setShowError(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>Checkout</Text>
      {!isLoggedIn ? (
        <View style={styles.guestBanner}>
          <Text style={styles.guestBannerText}>
            🔒 You'll need a free account to submit — log in or create one when
            you're ready to place your order.
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>1 · Contact details</Text>
      <TextInput style={styles.input} placeholder="Customer name" value={customerName} onChangeText={setCustomerName} />
      <TextInput style={styles.input} placeholder="Email" value={customerEmail} onChangeText={setCustomerEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Phone (for SMS updates, optional)" value={customerPhone} onChangeText={(v) => setCustomerPhone(v.replace(/[^0-9+]/g, ''))} keyboardType="phone-pad" />

      <Text style={styles.sectionTitle}>2 · How would you like to receive it?</Text>
      <View style={styles.paymentRow}>
        {FULFILLMENT_METHODS.map((m) => {
          const active = fulfillment === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.paymentChip, active && styles.paymentChipActive]}
              onPress={() => setFulfillment(m.id)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${m.label} — ${m.hint}`}
            >
              <Text style={[styles.paymentChipLabel, active && styles.paymentChipLabelActive]}>{m.label}</Text>
              <Text style={[styles.paymentChipHint, active && styles.paymentChipHintActive]}>{m.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {fulfillment === 'pickup' ? (
        <View style={styles.fulfillmentNote}>
          <Text style={styles.fulfillmentNoteTitle}>Pickup at the Sylver store</Text>
          <Text style={styles.fulfillmentNoteBody}>
            Your branch will contact you with the pickup schedule once the
            order is confirmed. Bring the inquiry reference from your orders
            screen when you collect.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>2b · Delivery address</Text>
          <TextInput
            style={[styles.input, styles.addressInput]}
            placeholder="House no., street, barangay, city, province"
            value={deliveryAddress}
            onChangeText={setDeliveryAddress}
            multiline
          />
          <View style={styles.fulfillmentNote}>
            <Text style={styles.fulfillmentNoteTitle}>Courier delivery</Text>
            <Text style={styles.fulfillmentNoteBody}>
              Delivery is arranged by the store; the schedule and any delivery
              charge are confirmed with you before dispatch.
            </Text>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>3 · Payment method</Text>
      <View style={styles.paymentRow}>
        {PAYMENT_METHODS.map((m) => {
          const active = paymentMethod === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.paymentChip, active && styles.paymentChipActive]}
              onPress={() => setPaymentMethod(m.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.paymentChipLabel, active && styles.paymentChipLabelActive]}>{m.label}</Text>
              <Text style={[styles.paymentChipHint, active && styles.paymentChipHintActive]}>{m.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>4 · Items ({itemCount})</Text>
      {selectedItems.length === 0 ? (
        <View style={styles.emptyCart}>
          <Text style={styles.emptyCartTitle}>Your cart is empty</Text>
          <Text style={styles.emptyCartSub}>
            Browse the catalog and tap + on the supplies you need, then come
            back here to check out.
          </Text>
          <TouchableOpacity
            style={styles.browseBtn}
            onPress={() => navigation.navigate('CatalogTab', { screen: 'Products' })}
            activeOpacity={0.8}
          >
            <Text style={styles.browseBtnText}>Browse products</Text>
          </TouchableOpacity>
        </View>
      ) : (
        selectedItems.map((item, idx) => (
          <View key={item.id ?? item.name ?? idx} style={styles.cartRow}>
            {(() => {
              const p = items.find((i) => Number(i.product.id) === Number(item.id));
              return p && p.product.image ? (
                <Image source={{ uri: imageUrl(p.product.image) }} style={styles.cartThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.cartThumb, styles.cartThumbPlaceholder]} />
              );
            })()}
            <View style={styles.cartInfo}>
              <Text style={styles.cartName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.cartPrice}>P{item.price} each</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setQty(item.id, item.qty - 1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.stepText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyText}>{item.qty}</Text>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => setQty(item.id, item.qty + 1)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.stepText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.cartRight}>
              <Text style={styles.lineTotal}>P{(item.price * item.qty).toFixed(2)}</Text>
              <TouchableOpacity onPress={() => removeItem(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {selectedItems.length > 0 ? (
        <TouchableOpacity
          style={styles.addMoreBtn}
          onPress={() => navigation.navigate('CatalogTab', { screen: 'Products' })}
          activeOpacity={0.8}
        >
          <Text style={styles.addMoreText}>+ Add more supplies</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.estimate}>Estimated total: P{estimatedCost.toFixed(2)}</Text>
      <TextInput style={styles.input} placeholder="Notes (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
      <View style={styles.termsCard}>
        <Text style={styles.termsTitle}>Ordering and cancellation terms</Text>
        {ORDER_TERMS.map((term, index) => (
          <Text key={`term-${index}`} style={styles.termsText}>• {term}</Text>
        ))}
        <TouchableOpacity
          style={styles.termsCheckRow}
          onPress={() => setTermsAccepted((accepted) => !accepted)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: termsAccepted }}
        >
          <Text style={styles.termsCheck}>{termsAccepted ? '☑' : '☐'}</Text>
          <Text style={styles.termsCheckText}>I have read and agree to these terms.</Text>
        </TouchableOpacity>
      </View>
      <Button
        title={submitting ? 'Placing order...' : 'Place Order'}
        onPress={submit}
        disabled={submitting || selectedItems.length === 0}
        color={colors.brandPrimary}
      />
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* Validation / submit error dialog */}
      <Dialog
        visible={showError}
        glyph="⚠️"
        title="Almost there"
        body={errorMsg}
        confirmLabel="Got it"
        onConfirm={() => setShowError(false)}
        onCancel={() => setShowError(false)}
      />

      {/* Order placed confirmation (COD path) */}
      <Dialog
        visible={showSuccess}
        glyph="🎉"
        title="Order Placed"
        body={`Your order (${successInfo.count} item${successInfo.count === 1 ? '' : 's'}, ${successInfo.method}) has been submitted. The store will review it shortly.`}
        confirmLabel="View my orders"
        onConfirm={() => {
          setShowSuccess(false);
          navigation.navigate('InquiryHistory');
        }}
        cancelLabel="Done"
        onCancel={() => setShowSuccess(false)}
      />

      {/* Account gate modal (Shopee/Lazada pattern: account only at the point
          of buying, browsing stays free). */}
      <Modal
        visible={showAuthGate}
        transparent
        // Native animates reliably; RN-web's CSS animation can stall in
        // embedded webviews and leave a click-through ghost — so skip it
        // there (MODAL_ANIMATION is the shared web-safe rule).
        animationType={MODAL_ANIMATION}
        onRequestClose={() => setShowAuthGate(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalGlyph}>🔒</Text>
            <Text style={styles.modalTitle}>Account Required</Text>
            <Text style={styles.modalBody}>
              Create a free account or log in to place your order inquiry.
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnPrimary]}
              onPress={() => {
                setShowAuthGate(false);
                navigation.navigate('Signup');
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.modalBtnPrimaryText}>Create Account</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnSecondary]}
              onPress={() => {
                setShowAuthGate(false);
                navigation.navigate('Login');
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.modalBtnSecondaryText}>Log In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowAuthGate(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.modalCancel}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  termsCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, marginBottom: 16, marginTop: 8, padding: 14 },
  termsTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  termsText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  termsCheckRow: { alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  termsCheck: { color: colors.brandPrimary, fontSize: 22, marginRight: 8 },
  termsCheckText: { color: colors.textPrimary, flex: 1, fontSize: 13, fontWeight: '700' },
  addMoreBtn: { alignItems: 'center', paddingVertical: 10 },
  addMoreText: { color: colors.brandPrimary, fontSize: 14, fontWeight: '700' },
  addressInput: { minHeight: 68, textAlignVertical: 'top' },
  browseBtn: { backgroundColor: colors.brandPrimary, borderRadius: 10, marginTop: 14, paddingHorizontal: 24, paddingVertical: 12 },
  browseBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cartInfo: { flex: 1, marginRight: 8 },
  cartName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  cartPrice: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  cartRight: { alignItems: 'flex-end' },
  cartRow: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, flexDirection: 'row', marginBottom: 10, padding: 12 },
  cartThumb: { backgroundColor: colors.background, borderRadius: 8, height: 52, marginRight: 12, width: 52 },
  cartThumbPlaceholder: { backgroundColor: '#e3eeda' },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  container: { backgroundColor: colors.background, flex: 1, padding: 20 },
  emptyCart: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 20 },
  emptyCartSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  emptyCartTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  estimate: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 12 },
  guestBanner: {
    backgroundColor: '#fff4e0',
    borderColor: '#f0c36d',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  guestBannerText: { color: '#7a5c00', fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: colors.surface, borderRadius: 10, color: colors.textPrimary, fontSize: 15, marginBottom: 12, padding: 12 },
  lineTotal: { color: colors.brandPrimary, fontSize: 14, fontWeight: '800' },
  message: { color: colors.success, marginTop: 16, textAlign: 'center' },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  modalBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  modalBtn: { alignItems: 'center', borderRadius: 12, marginBottom: 10, paddingVertical: 14, width: '100%' },
  modalBtnPrimary: { backgroundColor: colors.brandPrimary },
  modalBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  modalBtnSecondary: { backgroundColor: '#fff', borderColor: colors.brandPrimary, borderWidth: 1.5 },
  modalBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
  modalCancel: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  modalCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    maxWidth: 380,
    padding: 24,
    width: '100%',
  },
  modalGlyph: { fontSize: 34, marginBottom: 8 },
  modalTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800' },
  paymentChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    borderWidth: 1.5,
    flex: 1,
    paddingVertical: 12,
  },
  paymentChipActive: { backgroundColor: '#e9f7ee', borderColor: colors.brandPrimary },
  paymentChipHint: { color: colors.textSecondary, fontSize: 10, marginTop: 2 },
  paymentChipHintActive: { color: colors.brandPrimary },
  paymentChipLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  paymentChipLabelActive: { color: colors.brandPrimary },
  paymentRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  // What the chosen fulfilment method means for the customer, in one short
  // paragraph — the panel's "pickup / courier not stated".
  fulfillmentNote: {
    backgroundColor: colors.background,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    padding: 12,
  },
  fulfillmentNoteTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  fulfillmentNoteBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  qtyText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', minWidth: 26, textAlign: 'center' },
  removeText: { color: colors.error, fontSize: 12, marginTop: 6 },
  sectionTitle: { color: colors.textSecondary, fontSize: 16, fontWeight: '600', marginVertical: 12 },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 4 },
  stepText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  stepper: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.background, borderColor: 'rgba(0,0,0,0.1)', borderRadius: 8, borderWidth: 1, flexDirection: 'row', marginTop: 8 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
});

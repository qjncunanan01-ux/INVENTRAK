import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createOrderInquiry, getMe, listProducts, useSessionUsername } from '../api';
import { colors } from '../theme';

const PAYMENT_METHODS = [
  { id: 'cod', label: 'COD', hint: 'Cash on delivery' },
  { id: 'gcash', label: 'GCash', hint: 'Pay via GCash' },
  { id: 'card', label: 'Card', hint: 'Credit / debit card' },
];

export default function OrderInquiryScreen({ route, navigation }) {
  const preselectId = route.params?.preselectId;
  // Guests can fill the whole form, but must log in / create an account to
  // actually submit — the account is only required at the point of buying.
  const sessionUser = useSessionUsername(null);
  const isLoggedIn = !!sessionUser;
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProducts = async () => {
    try {
      const data = await listProducts();
      setProducts(data.data || (Array.isArray(data) ? data : []));
    } catch (err) {
      Alert.alert('Error', 'Failed to load products');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchProducts(); }, []);

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

  // Deep link from a product detail page: pre-fill that product's qty to 1,
  // but only ONCE per preselectId — refreshes must not re-fill after the
  // customer edits (or clears) the quantity themselves.
  const prefilledRef = useRef(null);
  useEffect(() => {
    if (preselectId && products.length > 0 && prefilledRef.current !== preselectId) {
      prefilledRef.current = preselectId;
      setQuantities((prev) => ({ ...prev, [preselectId]: '1' }));
    }
  }, [preselectId, products]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts();
  }, []);

  const selectedItems = useMemo(() => (Array.isArray(products) ? products : [])
    .filter(product => Number(quantities[product.id]) > 0)
    .map(product => ({
      id: product.id,
      name: product.name,
      qty: Number(quantities[product.id]),
      price: Number(product.price) || 0,
    })), [products, quantities]);

  const estimatedCost = selectedItems.reduce((sum, item) => sum + item.price * item.qty, 0);

  const submit = async () => {
    // Checkout gate: buying requires an account (browsing does not).
    if (!isLoggedIn) {
      Alert.alert(
        'Account Required',
        'Create a free account or log in to place your order inquiry.',
        [
          { text: 'Create Account', onPress: () => navigation.navigate('Signup') },
          { text: 'Log In', onPress: () => navigation.navigate('Login') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    if (!customerName.trim()) {
      Alert.alert('Validation', 'Please enter your name');
      return;
    }
    if (!customerEmail.trim()) {
      Alert.alert('Validation', 'Please enter your email');
      return;
    }
    if (selectedItems.length === 0) {
      Alert.alert('Validation', 'Please select at least one product');
      return;
    }
    if (!deliveryAddress.trim()) {
      Alert.alert('Validation', 'Please enter your delivery address');
      return;
    }
    setSubmitting(true);
    try {
      await createOrderInquiry({
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone.trim() || null,
        products: selectedItems.map(item => `${item.name} x${item.qty}`),
        estimated_cost: estimatedCost,
        notes,
        delivery_address: deliveryAddress.trim(),
        payment_method: paymentMethod,
      });
      setMessage('Order placed successfully!');
      // Checkout done (Shopee/Lazada style): the order is in as "pending" —
      // lead straight to order history to watch it get approved/fulfilled.
      Alert.alert(
        'Order Placed 🎉',
        `Your order (${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''}, ${paymentMethod.toUpperCase()}) has been submitted. The store will review it shortly.`,
        [
          { text: 'View my orders', onPress: () => navigation.navigate('InquiryHistory') },
          { text: 'Done', style: 'cancel' },
        ]
      );
      setQuantities({});
      setNotes('');
      setDeliveryAddress('');
    } catch (err) {
      setMessage('Failed to submit inquiry.');
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const prodList = Array.isArray(products) ? products : [];

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
      <TextInput style={styles.input} placeholder="Phone (for SMS updates, optional)" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />

      <Text style={styles.sectionTitle}>2 · Delivery address</Text>
      <TextInput
        style={[styles.input, styles.addressInput]}
        placeholder="House no., street, barangay, city, province"
        value={deliveryAddress}
        onChangeText={setDeliveryAddress}
        multiline
      />

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

      <Text style={styles.sectionTitle}>4 · Items</Text>
      <FlatList
        data={prodList}
        keyExtractor={item => item.id?.toString()}
        scrollEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        renderItem={({ item }) => (
          <View style={styles.productRow}>
            <View style={styles.productInfo}>
              <Text style={styles.productName}>{item.name}</Text>
              <Text style={styles.productPrice}>P{item.price} each</Text>
            </View>
            <TextInput
              style={styles.qtyInput}
              value={quantities[item.id]?.toString() || ''}
              onChangeText={value => setQuantities({ ...quantities, [item.id]: value.replace(/[^0-9]/g, '') })}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No products available.</Text>}
      />
      <Text style={styles.estimate}>Estimated total: P{estimatedCost.toFixed(2)}</Text>
      <TextInput style={styles.input} placeholder="Notes (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
      <Button
        title={submitting ? 'Placing order...' : 'Place Order'}
        onPress={submit}
        disabled={submitting || selectedItems.length === 0}
        color={colors.brandPrimary}
      />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, color: colors.textPrimary },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginVertical: 12, color: colors.textSecondary },
  input: { backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginBottom: 12, color: colors.textPrimary, fontSize: 15 },
  addressInput: { minHeight: 68, textAlignVertical: 'top' },
  paymentRow: { flexDirection: 'row', marginBottom: 14, gap: 10 },
  paymentChip: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  paymentChipActive: { borderColor: colors.brandPrimary, backgroundColor: '#e9f7ee' },
  paymentChipLabel: { fontWeight: '700', color: colors.textPrimary, fontSize: 15 },
  paymentChipLabelActive: { color: colors.brandPrimary },
  paymentChipHint: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  paymentChipHintActive: { color: colors.brandPrimary },
  productRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, justifyContent: 'space-between', backgroundColor: colors.surface, padding: 10, borderRadius: 10 },
  productInfo: { flex: 1, marginRight: 12 },
  productName: { fontWeight: '600', color: colors.textPrimary, fontSize: 15 },
  productPrice: { color: colors.textSecondary, fontSize: 13 },
  qtyInput: { width: 70, backgroundColor: colors.background, padding: 10, borderRadius: 8, textAlign: 'center', color: colors.textPrimary, fontSize: 16 },
  estimate: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: colors.textPrimary },
  message: { marginTop: 16, color: colors.success, textAlign: 'center' },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
  guestBanner: {
    backgroundColor: '#fff4e0',
    borderWidth: 1,
    borderColor: '#f0c36d',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  guestBannerText: { color: '#7a5c00', fontSize: 13, lineHeight: 19 },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { createOrderInquiry, listProducts } from '../api';
import { colors } from '../theme';

export default function OrderInquiryScreen({ route, navigation }) {
  const preselectId = route.params?.preselectId;
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
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
    setSubmitting(true);
    try {
      await createOrderInquiry({
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone.trim() || null,
        products: selectedItems.map(item => `${item.name} x${item.qty}`),
        estimated_cost: estimatedCost,
        notes,
      });
      setMessage('Inquiry submitted successfully!');
      Alert.alert('Success', 'Your order inquiry has been submitted.');
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setQuantities({});
      setNotes('');
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
    <View style={styles.container}>
      <Text style={styles.title}>Order Inquiry</Text>
      <TextInput style={styles.input} placeholder="Customer name" value={customerName} onChangeText={setCustomerName} />
      <TextInput style={styles.input} placeholder="Email" value={customerEmail} onChangeText={setCustomerEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Phone (for SMS updates, optional)" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
      <Text style={styles.sectionTitle}>Select products and quantities</Text>
      <FlatList
        data={prodList}
        keyExtractor={item => item.id?.toString()}
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
      <Text style={styles.estimate}>Estimated cost: P{estimatedCost.toFixed(2)}</Text>
      <TextInput style={styles.input} placeholder="Notes (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
      <Button
        title={submitting ? 'Submitting...' : 'Submit Inquiry'}
        onPress={submit}
        disabled={submitting || selectedItems.length === 0}
        color={colors.brandPrimary}
      />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, color: colors.textPrimary },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginVertical: 12, color: colors.textSecondary },
  input: { backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginBottom: 12, color: colors.textPrimary, fontSize: 15 },
  productRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, justifyContent: 'space-between', backgroundColor: colors.surface, padding: 10, borderRadius: 10 },
  productInfo: { flex: 1, marginRight: 12 },
  productName: { fontWeight: '600', color: colors.textPrimary, fontSize: 15 },
  productPrice: { color: colors.textSecondary, fontSize: 13 },
  qtyInput: { width: 70, backgroundColor: colors.background, padding: 10, borderRadius: 8, textAlign: 'center', color: colors.textPrimary, fontSize: 16 },
  estimate: { fontSize: 18, fontWeight: '600', marginBottom: 12, color: colors.textPrimary },
  message: { marginTop: 16, color: colors.success, textAlign: 'center' },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
});

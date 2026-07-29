import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_BASE_URL } from '../api';

export default function OrderInquiryScreen() {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/products`).then(r => setProducts(r.data));
  }, []);

  const selectedItems = useMemo(() => products
    .filter(product => Number(quantities[product.id]) > 0)
    .map(product => ({
      id: product.id,
      name: product.name,
      qty: Number(quantities[product.id]),
      price: Number(product.price) || 0,
    })), [products, quantities]);

  const estimatedCost = selectedItems.reduce((sum, item) => sum + item.price * item.qty, 0);

  const submit = async () => {
    try {
      await axios.post(`${API_BASE_URL}/api/order-inquiries`, {
        customer_name: customerName,
        customer_email: customerEmail,
        products: selectedItems.map(item => `${item.name} x${item.qty}`),
        estimated_cost: estimatedCost,
        notes,
      });
      setMessage('Inquiry submitted successfully!');
      setCustomerName('');
      setCustomerEmail('');
      setQuantities({});
      setNotes('');
    } catch (err) {
      setMessage('Failed to submit inquiry. Please try again.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Order Inquiry</Text>
      <TextInput style={styles.input} placeholder="Customer name" value={customerName} onChangeText={setCustomerName} />
      <TextInput style={styles.input} placeholder="Email" value={customerEmail} onChangeText={setCustomerEmail} keyboardType="email-address" />
      <Text style={styles.sectionTitle}>Select products</Text>
      {products.map(product => (
        <View key={product.id} style={styles.productRow}>
          <Text style={styles.productName}>{product.name}</Text>
          <TextInput
            style={styles.qtyInput}
            value={quantities[product.id]?.toString() || ''}
            onChangeText={value => setQuantities({ ...quantities, [product.id]: value.replace(/[^0-9]/g, '') })}
            placeholder="Qty"
            keyboardType="numeric"
          />
        </View>
      ))}
      <Text style={styles.estimate}>Estimated cost: ₱{estimatedCost.toFixed(2)}</Text>
      <TextInput style={styles.input} placeholder="Notes" value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
      <Button title="Submit Inquiry" onPress={submit} disabled={!customerName || !customerEmail || selectedItems.length === 0} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f4f6fd' },
  title: { fontSize: 24, marginBottom: 16 },
  sectionTitle: { fontSize: 18, marginVertical: 12 },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 12 },
  productRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, justifyContent: 'space-between' },
  productName: { flex: 1, marginRight: 12 },
  qtyInput: { width: 80, backgroundColor: '#fff', padding: 10, borderRadius: 10, textAlign: 'center' },
  estimate: { fontSize: 16, marginBottom: 12 },
  message: { marginTop: 16, color: 'green' },
  error: { marginTop: 16, color: 'red' }
});

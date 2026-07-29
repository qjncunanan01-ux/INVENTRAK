import axios from 'axios';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from '../api';

export default function InquiryHistoryScreen() {
  const [inquiries, setInquiries] = useState([]);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/order-inquiries`).then((response) => {
      setInquiries(response.data);
    }).catch(() => {
      setInquiries([]);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order Inquiry History</Text>
      <FlatList
        data={inquiries}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => {
          let productsDisplay = item.products;
          try {
            const parsed = JSON.parse(item.products);
            productsDisplay = Array.isArray(parsed) ? parsed.join(', ') : JSON.stringify(parsed);
          } catch {
            productsDisplay = item.products;
          }

          return (
            <View style={styles.card}>
              <Text style={styles.itemTitle}>{item.customer_name}</Text>
              <Text>Email: {item.customer_email}</Text>
              <Text>Status: {item.status}</Text>
              <Text>Estimated cost: ₱{Number(item.estimated_cost).toFixed(2)}</Text>
              <Text numberOfLines={3}>Products: {productsDisplay}</Text>
              <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No inquiries found yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f4f6fd' },
  title: { fontSize: 24, marginBottom: 16 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 12 },
  itemTitle: { fontWeight: '700', marginBottom: 6 },
  date: { marginTop: 8, color: '#555', fontSize: 12 },
  empty: { marginTop: 20, textAlign: 'center', color: '#666' }
});

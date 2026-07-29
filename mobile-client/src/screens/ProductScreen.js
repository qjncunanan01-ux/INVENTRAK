import axios from 'axios';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_BASE_URL } from '../api';

export default function ProductScreen() {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/products`).then(r => setProducts(r.data));
  }, []);
  const filtered = products.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Browse Products</Text>
      <TextInput style={styles.input} placeholder="Search products" value={filter} onChangeText={setFilter} />
      <FlatList
        data={filtered}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.productName}>{item.name}</Text>
            <Text>{item.category} • {item.size}</Text>
            <Text>₱{item.price}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f4f6fd' },
  title: { fontSize: 22, marginBottom: 12 },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 12 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 10 }
});

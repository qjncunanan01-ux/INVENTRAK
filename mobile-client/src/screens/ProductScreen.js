import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiGet } from '../api';
import { colors } from '../theme';

export default function ProductScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [error, setError] = useState('');

  const fetchProducts = async () => {
    try {
      const data = await apiGet('/api/products');
      setProducts(data.data || data);
      setError('');
    } catch (err) {
      setError(err.message);
      Alert.alert('Error', 'Failed to load products. Please pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchProducts(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts();
  }, []);

  const filtered = Array.isArray(products)
    ? products.filter(p => p.name?.toLowerCase().includes(filter.toLowerCase()))
    : [];

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (selectedProduct) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setSelectedProduct(null)} style={styles.backButton}>
          <Text style={styles.backText}>{'< Back to list'}</Text>
        </TouchableOpacity>
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedProduct.name}</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Category:</Text>
            <Text>{selectedProduct.category}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Brand:</Text>
            <Text>{selectedProduct.brand || '-'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Size:</Text>
            <Text>{selectedProduct.size || '-'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Unit:</Text>
            <Text>{selectedProduct.unit || 'pcs'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Price:</Text>
            <Text style={styles.price}>P{selectedProduct.price}</Text>
          </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Browse Products</Text>
      <TextInput
        style={styles.input}
        placeholder="Search products by name..."
        value={filter}
        onChangeText={setFilter}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id?.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setSelectedProduct(item)}>
            <View style={styles.card}>
              <Text style={styles.productName}>{item.name}</Text>
              <Text style={styles.productMeta}>{item.category} &bull; {item.size || 'N/A'}</Text>
              <Text style={styles.price}>P{item.price}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No products found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12, color: colors.textPrimary },
  input: { backgroundColor: colors.surface, padding: 12, borderRadius: 10, marginBottom: 12, color: colors.textPrimary, fontSize: 15 },
  card: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  productName: { fontWeight: '700', marginBottom: 4, color: colors.textPrimary, fontSize: 16 },
  productMeta: { color: colors.textSecondary, marginBottom: 4 },
  price: { color: colors.brandPrimary, fontWeight: '600', fontSize: 15 },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
  error: { color: colors.error, marginBottom: 8, textAlign: 'center' },
  backButton: { paddingVertical: 10, marginBottom: 10 },
  backText: { color: colors.info, fontSize: 16, fontWeight: '600' },
  detailCard: { backgroundColor: colors.surface, padding: 20, borderRadius: 14 },
  detailTitle: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: colors.textPrimary },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  detailLabel: { color: colors.textSecondary, fontWeight: '500' },
});

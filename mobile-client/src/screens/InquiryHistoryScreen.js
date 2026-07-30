import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '../api';
import { colors } from '../theme';

export default function InquiryHistoryScreen({ navigation }) {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const data = await apiGet('/api/order-inquiries');
      setInquiries(data.data || (Array.isArray(data) ? data : []));
    } catch (err) {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return colors.info;
      case 'fulfilled': return colors.success;
      case 'rejected': return colors.error;
      default: return colors.warning;
    }
  };

  const inquiryList = Array.isArray(inquiries) ? inquiries : [];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order Inquiry History</Text>
      <Text style={styles.subtitle}>{inquiryList.length} total inquiries</Text>
      <FlatList
        data={inquiryList}
        keyExtractor={(item) => item.id?.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
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
              <View style={styles.cardHeader}>
                <Text style={styles.itemTitle}>{item.customer_name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              <Text style={styles.detail}>Email: {item.customer_email}</Text>
              <Text style={styles.detail}>Cost: P{Number(item.estimated_cost).toFixed(2)}</Text>
              <Text style={styles.detail} numberOfLines={2}>Products: {productsDisplay}</Text>
              <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
          );
        }
        ListEmptyComponent={<Text style={styles.empty}>No inquiries found yet. Submit one from the Order Inquiry screen.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4, color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  card: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemTitle: { fontWeight: '700', fontSize: 16, color: colors.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  detail: { color: colors.textSecondary, marginBottom: 3, fontSize: 13 },
  date: { marginTop: 6, color: colors.textSecondary, fontSize: 12 },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
});

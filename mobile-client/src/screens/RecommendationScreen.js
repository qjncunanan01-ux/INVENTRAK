import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '../api';
import { colors } from '../theme';

export default function RecommendationScreen({ navigation }) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const data = await apiGet('/api/optimization/abc');
      setRecommendations(data.data ? data.data.slice(0, 6) : (Array.isArray(data) ? data.slice(0, 6) : []));
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

  const getBadge = (cls) => {
    if (cls === 'A') return { bg: '#d32f2f', label: 'High Priority' };
    if (cls === 'B') return { bg: '#f9a825', label: 'Medium' };
    return { bg: '#2e7d32', label: 'Low' };
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Suggested Supplies</Text>
      <Text style={styles.subtitle}>ABC-classified top recommendations</Text>
      <FlatList
        data={recommendations}
        keyExtractor={item => item.id?.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        renderItem={({ item }) => {
          const badge = getBadge(item.classification);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.productName}>{item.name}</Text>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.badgeText}>{item.classification}</Text>
                </View>
              <Text style={styles.meta}>Value: {item.value} | {badge.label}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No recommendations available.</Text>}
      />
      <View style={styles.spacer} />
      <Button title="Back to Home" onPress={() => navigation.goBack()} color={colors.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4, color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  card: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  productName: { fontWeight: '700', fontSize: 16, color: colors.textPrimary, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  empty: { marginTop: 20, textAlign: 'center', color: colors.textSecondary },
  spacer: { height: 16 },
});

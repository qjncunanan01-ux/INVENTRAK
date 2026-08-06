import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { listOrderInquiries, useSessionUsername } from '../api';
import { colors } from '../theme';

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'rejected', label: 'Rejected' },
];

export default function InquiryHistoryScreen({ navigation }) {
  // Order history is tied to a customer account: guests get a sign-in prompt
  // instead of an empty list.
  const isLoggedIn = !!useSessionUsername(null);
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('all');

  const fetchData = useCallback(async () => {
    try {
      const data = await listOrderInquiries();
      setInquiries(data.data || (Array.isArray(data) ? data : []));
    } catch (err) {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Only fetch while logged in — and REFETCH when the user logs in from the
  // guest gate (the screen stays mounted across login, so a mount-only fetch
  // would leave the list empty until pull-to-refresh).
  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return colors.info;
      case 'fulfilled': return colors.success;
      case 'rejected': return colors.error;
      default: return colors.warning;
    }
  };

  const counts = useMemo(() => {
    const c = { all: inquiries.length, pending: 0, approved: 0, fulfilled: 0, rejected: 0 };
    inquiries.forEach((i) => { if (c[i.status] !== undefined) c[i.status] += 1; });
    return c;
  }, [inquiries]);

  const shown = tab === 'all' ? inquiries : inquiries.filter((i) => i.status === tab);

  const renderProducts = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.join(', ') : JSON.stringify(parsed);
    } catch {
      return raw;
    }
  };

  // Guest state: browsing is free, but order history needs an account. This
  // must render BEFORE the loading spinner — while a guest we skip the fetch
  // entirely, so loading never resolves.
  if (!isLoggedIn) {
    return (
      <View style={styles.center}>
        <Text style={styles.guestGlyph}>✓</Text>
        <Text style={styles.guestTitle}>Log in to see your orders</Text>
        <Text style={styles.guestSub}>
          Your order inquiries will appear here once you have an account.
        </Text>
        <TouchableOpacity style={styles.guestBtnPrimary} onPress={() => navigation.navigate('Signup')}>
          <Text style={styles.guestBtnPrimaryText}>Create Account</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.guestBtnSecondary} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.guestBtnSecondaryText}>Log In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Status tabs with counts, Shopee To Pay/To Ship/To Receive style */}
      <View style={styles.tabs}>
        <FlatList
          horizontal
          data={STATUS_TABS}
          keyExtractor={(t) => t.key}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const active = tab === item.key;
            return (
              <TouchableOpacity
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setTab(item.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.label}
                </Text>
                <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                  <Text style={[styles.countText, active && styles.countTextActive]}>
                    {counts[item.key] || 0}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={shown}
        keyExtractor={(item) => item.id?.toString()}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.itemTitle}>{item.customer_name}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>

            <Text style={styles.detail}>Email: {item.customer_email}</Text>
            <Text style={styles.detail}>
              Cost: P{Number(item.estimated_cost).toFixed(2)}
            </Text>
            <Text style={styles.detail} numberOfLines={2}>
              Products: {renderProducts(item.products)}
            </Text>
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === 'all'
              ? 'No inquiries yet. Submit one from the Order Inquiry tab.'
              : `No ${tab} inquiries.`}
          </Text>
        }
      />

      <TouchableOpacity
        style={styles.newInquiry}
        onPress={() => navigation.navigate('OrderInquiry')}
      >
        <Text style={styles.newInquiryText}>+ New Order Inquiry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  tabs: { paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 4, borderRadius: 18, backgroundColor: colors.background },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  countBadge: { marginLeft: 6, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  countTextActive: { color: '#fff' },
  listContent: { padding: 16 },
  card: { backgroundColor: colors.surface, padding: 14, borderRadius: 12, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemTitle: { fontWeight: '700', fontSize: 16, color: colors.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  detail: { color: colors.textSecondary, marginBottom: 3, fontSize: 13 },
  date: { marginTop: 6, color: colors.textSecondary, fontSize: 12 },
  empty: { marginTop: 24, textAlign: 'center', color: colors.textSecondary },
  newInquiry: { marginHorizontal: 16, marginBottom: 20, backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  newInquiryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestGlyph: { fontSize: 40, color: colors.brandPrimary, fontWeight: '700', marginBottom: 12 },
  guestTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  guestSub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 24, paddingHorizontal: 32, lineHeight: 19 },
  guestBtnPrimary: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48, marginBottom: 10 },
  guestBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestBtnSecondary: { borderWidth: 1.5, borderColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48 },
  guestBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
});

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { listOrderInquiries, useSessionUsername } from '../api';
import EmptyState from '../EmptyState';
import { useThemeColors } from '../theme-context';

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'rejected', label: 'Rejected' },
];

export default function InquiryHistoryScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Order history is tied to a customer account: guests get a sign-in prompt
  // instead of an empty list.
  const isLoggedIn = !!useSessionUsername(null);
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

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

  // Fetch while logged in — and REFETCH every time the tab gains focus, so a
  // freshly placed order (e.g. "View my orders" right after checkout) shows up
  // immediately instead of a stale list until pull-to-refresh. Also covers the
  // guest gate login path (the screen stays mounted across login).
  useFocusEffect(
    useCallback(() => {
      if (isLoggedIn) fetchData();
    }, [isLoggedIn, fetchData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return colors.info;
      case 'fulfilled': return colors.success;
      case 'delivered': return colors.success;
      case 'rejected': return colors.error;
      default: return colors.warning;
    }
  };

  const counts = useMemo(() => {
    const c = { all: inquiries.length, pending: 0, approved: 0, fulfilled: 0, delivered: 0, rejected: 0 };
    inquiries.forEach((i) => { if (c[i.status] !== undefined) c[i.status] += 1; });
    return c;
  }, [inquiries]);

  // Rendered product lines for a card (also used by the search filter).
  // Handles the structured line items the app now sends ({ name, qty, price,
  // original_price }) AND legacy string entries ('Widget x2'), so older orders
  // still render correctly.
  const renderProducts = (raw) => {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
    if (!Array.isArray(parsed)) return parsed ? JSON.stringify(parsed) : '';
    return parsed
      .map((line) => {
        if (typeof line === 'string') return line;
        if (!line || typeof line !== 'object') return '';
        const qty = line.qty > 1 ? ` x${line.qty}` : '';
        const base = `${line.name || 'Item'}${qty}`;
        // Show the price the customer was charged, with a discount marker when
        // the line carried a deal (original price present + higher).
        const price = Number(line.unit_price ?? line.price);
        const original = Number(line.original_price);
        if (price > 0 && original > price) {
          return `${base} (P${price} deal, was P${original})`;
        }
        if (price > 0) return `${base} (P${price})`;
        return base;
      })
      .filter(Boolean)
      .join(', ');
  };

  // Live search (reviewer-style): filter by customer name, email, product,
  // payment method, or status — combined with the status tabs below.
  const shown = (tab === 'all' ? inquiries : inquiries.filter((i) => i.status === tab)).filter((i) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const productsText = renderProducts(i.products).toLowerCase();
    return (i.customer_name || '').toLowerCase().includes(q) ||
      (i.customer_email || '').toLowerCase().includes(q) ||
      (i.status || '').toLowerCase().includes(q) ||
      (i.payment_method || '').toLowerCase().includes(q) ||
      productsText.includes(q);
  });

  // Status timeline (Shopee-style): Placed -> Approved -> Fulfilled -> Delivered.
  const renderTimeline = (item) => {
    let events = [];
    try {
      const parsed = JSON.parse(item.status_history || '[]');
      if (Array.isArray(parsed)) events = parsed;
    } catch {}
    if (events.length === 0) {
      events = [{ status: item.status, at: item.created_at }];
    }
    const labels = { pending: 'Placed', approved: 'Approved', fulfilled: 'Fulfilled', delivered: 'Delivered', rejected: 'Rejected' };
    return (
      <View style={styles.timeline}>
        {events.map((e, idx) => (
          <View key={idx} style={styles.timelineStep}>
            <View style={[styles.timelineDot, e.status === item.status && styles.timelineDotActive]} />
            <View style={styles.timelineBody}>
              <Text style={styles.timelineLabel}>{labels[e.status] || e.status}</Text>
              <Text style={styles.timelineDate}>
                {e.at ? new Date(e.at).toLocaleString() : ''}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
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
      {/* Live search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search orders, products, status..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

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
        keyExtractor={(item, index) => item?.id ?? item?.name ?? index}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.itemTitle}>Order #{item.id}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>
            {item.customer_name ? <Text style={styles.detail}>Customer: {item.customer_name}</Text> : null}

            <Text style={styles.detail}>Email: {item.customer_email}</Text>
            <Text style={styles.detail}>
              Cost: P{Number(item.estimated_cost).toFixed(2)} ·{' '}
              Payment: {(item.payment_method || 'cod').toUpperCase()}
              {item.payment_status === 'paid' ? ' · ✅ PAID' : ''}
              {item.payment_status === 'unpaid' && item.payment_method === 'gcash' ? ' · ⏳ Unpaid' : ''}
            </Text>
            {item.delivery_address ? (
              <Text style={styles.detail} numberOfLines={2}>
                📍 {item.delivery_address}
              </Text>
            ) : null}
            <Text style={styles.detail} numberOfLines={2}>
              Products: {renderProducts(item.products)}
            </Text>
            {renderTimeline(item)}
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            glyph="📋"
            title={tab === 'all' ? 'No inquiries yet' : `No ${tab} inquiries`}
            sub={
              tab === 'all'
                ? 'Your submitted order inquiries will appear here. Start one from the Order Inquiry tab.'
                : `You have no ${tab} orders right now — try another status or submit a new inquiry.`
            }
          />
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

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.surface },
  searchInput: {
    backgroundColor: colors.background,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
  },
  tabs: { paddingVertical: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
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
  timeline: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  timelineStep: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.12)', marginTop: 4, marginRight: 8 },
  timelineDotActive: { backgroundColor: colors.brandPrimary },
  timelineBody: { flex: 1 },
  timelineLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, textTransform: 'capitalize' },
  timelineDate: { fontSize: 11, color: colors.textSecondary },
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

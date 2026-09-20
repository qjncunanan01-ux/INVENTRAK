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

  const fetchData = useCallback(async() => {
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
    }, [isLoggedIn, fetchData]),
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
  card: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 12, padding: 14 },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  container: { backgroundColor: colors.background, flex: 1 },
  countBadge: { backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 9, marginLeft: 6, paddingHorizontal: 6, paddingVertical: 1 },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  countTextActive: { color: '#fff' },
  date: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  detail: { color: colors.textSecondary, fontSize: 13, marginBottom: 3 },
  guestBtnPrimary: { backgroundColor: colors.brandPrimary, borderRadius: 12, marginBottom: 10, paddingHorizontal: 48, paddingVertical: 14 },
  guestBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestBtnSecondary: { borderColor: colors.brandPrimary, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 48, paddingVertical: 14 },
  guestBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  guestGlyph: { color: colors.brandPrimary, fontSize: 40, fontWeight: '700', marginBottom: 12 },
  guestSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 24, marginTop: 6, paddingHorizontal: 32, textAlign: 'center' },
  guestTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  itemTitle: { color: colors.textPrimary, flex: 1, fontSize: 16, fontWeight: '700' },
  listContent: { padding: 16 },
  newInquiry: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 12, marginBottom: 20, marginHorizontal: 16, paddingVertical: 14 },
  newInquiryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  searchInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchWrap: { backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 12 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  tab: { alignItems: 'center', backgroundColor: colors.background, borderRadius: 18, flexDirection: 'row', marginHorizontal: 4, paddingHorizontal: 14, paddingVertical: 8 },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabs: { backgroundColor: colors.surface, borderBottomColor: 'rgba(0,0,0,0.06)', borderBottomWidth: 1, paddingVertical: 10 },
  timeline: { borderTopColor: 'rgba(0,0,0,0.05)', borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  timelineBody: { flex: 1 },
  timelineDate: { color: colors.textSecondary, fontSize: 11 },
  timelineDot: { backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 5, height: 10, marginRight: 8, marginTop: 4, width: 10 },
  timelineDotActive: { backgroundColor: colors.brandPrimary },
  timelineLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  timelineStep: { alignItems: 'flex-start', flexDirection: 'row', marginBottom: 6 },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { listOrderInquiries, useSessionUsername } from '../api';
import EmptyState from '../EmptyState';
import { useThemeColors } from '../theme-context';

const LABELS = { pending: 'Placed', approved: 'Approved', fulfilled: 'Fulfilled', delivered: 'Delivered', rejected: 'Rejected' };
// Status -> vector icon (MaterialCommunityIcons), same family as the rest of
// the app's iconography.
const GLYPHS = { pending: 'clock-outline', approved: 'check-circle-outline', fulfilled: 'package-variant-closed', delivered: 'home-outline', rejected: 'close-circle-outline' };

// Notification Module (reviewer requirement): an in-app feed of order status
// updates, mirroring the email/SMS status notifications the backend already
// sends. Each card is one status event from the order's status_history
// timeline, newest first — so customers can see the store's latest action at
// a glance without opening each order.
export default function NotificationsScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isLoggedIn = !!useSessionUsername(null);
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const data = await listOrderInquiries({ limit: 100 });
      setInquiries(data.data || (Array.isArray(data) ? data : []));
    } catch (err) {
      // Silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // Flatten every order's status_history into notification cards.
  const notifications = useMemo(() => {
    const events = [];
    inquiries.forEach((o) => {
      let history = [];
      try {
        const parsed = JSON.parse(o.status_history || '[]');
        if (Array.isArray(parsed)) history = parsed;
      } catch {}
      if (history.length === 0) history = [{ status: o.status, at: o.created_at }];
      // Skip the initial 'placed' event (not a notification) unless it's all
      // there is (then it IS the update the customer should see).
      const shown = history.length > 1 ? history.slice(1) : history;
      shown.forEach((e) => {
        events.push({
          key: `${o.id}-${e.at}`,
          orderId: o.id,
          status: e.status,
          at: e.at,
          name: o.customer_name,
          cost: o.estimated_cost,
        });
      });
    });
    return events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [inquiries]);

  // Live search: filter notifications by order id, status, or label.
  const shown = notifications.filter((n) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return String(n.orderId).includes(q) ||
      (n.status || '').toLowerCase().includes(q) ||
      (LABELS[n.status] || '').toLowerCase().includes(q);
  });

  if (!isLoggedIn) {
    return (
      <View style={styles.center}>
        <Text style={styles.guestGlyph}>🔔</Text>
        <Text style={styles.guestTitle}>Log in to see updates</Text>
        <Text style={styles.guestSub}>
          Order status notifications will appear here once you have an account.
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
      <Text style={styles.title}>Notifications</Text>
      <Text style={styles.subtitle}>Latest order status updates</Text>
      <TextInput
        style={styles.searchInput}
        placeholder="Search by order # or status..."
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        keyboardType="default"
      />
      <FlatList
        data={shown}
        keyExtractor={(n, index) => n?.key ?? index}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('InquiryHistory')}
          >
            <MaterialCommunityIcons name={GLYPHS[item.status] || 'bell-outline'} size={22} color={colors.brandPrimary} style={styles.glyph} />
            <View style={styles.body}>
              <Text style={styles.cardTitle}>
                Order #{item.orderId} is {LABELS[item.status] || item.status}
              </Text>
              <Text style={styles.cardMeta}>
                {item.name} · P{Number(item.cost || 0).toFixed(2)}
              </Text>
            </View>
            <Text style={styles.time}>{item.at ? new Date(item.at).toLocaleDateString() : ''}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            glyph="🔔"
            title="No notifications yet"
            sub="Your order status updates will show up here — place an order inquiry and we'll keep you posted."
          />
        }
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 14 },
  searchInput: {
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
    marginBottom: 12,
  },
  list: { paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  glyph: { marginRight: 12 },
  body: { flex: 1 },
  cardTitle: { fontWeight: '700', color: colors.textPrimary, fontSize: 15 },
  cardMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  time: { color: colors.textSecondary, fontSize: 11, marginLeft: 8 },
  guestGlyph: { fontSize: 40, color: colors.brandPrimary, fontWeight: '700', marginBottom: 12 },
  guestTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  guestSub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 24, paddingHorizontal: 32, lineHeight: 19 },
  guestBtnPrimary: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48, marginBottom: 10 },
  guestBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestBtnSecondary: { borderWidth: 1.5, borderColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48 },
  guestBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
});

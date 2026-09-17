import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { listStockAdjustments } from '../api';
import { useThemeColors } from '../theme-context';

// MY REQUESTS — every adjustment this app (i.e., this staff member) has
// submitted, newest first, with its live approval status. The row shape
// comes from GET /api/stock-adjustments: { id, product_name, location_name,
// new_qty, current_qty, reason, status, created_at, decided_at, decided_by }.
const STATUS_META = {
  pending: { glyph: '⏳', label: 'Pending' },
  approved: { glyph: '✅', label: 'Approved' },
  rejected: { glyph: '❌', label: 'Rejected' },
};

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

export default function RequestsScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const r = await listStockAdjustments();
      const list = Array.isArray(r) ? r : (r && r.data) || [];
      // Newest first (the endpoint returns insertion order; unshift puts new
      // rows at index 0, but sort defensively so the feed is always fresh-first).
      list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setRows(list);
    } catch {
      setError('Could not load requests. Pull to refresh.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Requests</Text>
        <Text style={styles.subtitle}>
          {rows.filter((r) => r.status === 'pending').length} pending ·{' '}
          {rows.filter((r) => r.status === 'approved').length} approved
        </Text>
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />
        }
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status] || STATUS_META.pending;
          const delta = Number(item.new_qty) - Number(item.current_qty);
          return (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.product} numberOfLines={1}>{item.product_name}</Text>
                <Text
                  style={[
                    styles.badge,
                    item.status === 'approved' && styles.badgeApproved,
                    item.status === 'rejected' && styles.badgeRejected,
                    item.status === 'pending' && styles.badgePending,
                  ]}
                >
                  {meta.glyph} {meta.label}
                </Text>
              </View>
              <Text style={styles.meta}>
                {item.location_name} · {item.current_qty} → <Text style={styles.qty}>{item.new_qty}</Text>
                {' '}({delta >= 0 ? '+' : ''}{delta})
              </Text>
              {item.reason ? (
                <Text style={styles.reason} numberOfLines={2}>“{item.reason}”</Text>
              ) : null}
              <Text style={styles.dates}>
                submitted {formatDate(item.created_at)}
                {item.decided_at ? ` · decided ${formatDate(item.decided_at)}${item.decided_by ? ` by ${item.decided_by}` : ''}` : ''}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No adjustment requests yet. Submit one from Scan or Count.
          </Text>
        }
      />
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    row: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    product: { flex: 1, color: colors.textPrimary, fontWeight: '700', fontSize: 14, paddingRight: 8 },
    badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
    badgePending: { color: colors.pending, backgroundColor: 'rgba(184,134,11,0.12)' },
    badgeApproved: { color: colors.approved, backgroundColor: 'rgba(46,125,50,0.12)' },
    badgeRejected: { color: colors.rejected, backgroundColor: 'rgba(211,47,47,0.12)' },
    meta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
    qty: { color: colors.textPrimary, fontWeight: '800' },
    reason: { color: colors.textPrimary, fontSize: 12, marginTop: 4, lineHeight: 17, fontStyle: 'italic' },
    dates: { color: colors.textSecondary, fontSize: 10, marginTop: 6 },
    err: { color: colors.error, fontSize: 12, paddingHorizontal: 16, marginBottom: 6 },
    empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 13, lineHeight: 19 },
  });

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSessionUserId, getSessionUsername, listStockAdjustments } from '../api';
import { useThemeColors } from '../theme-context';

// MY REQUESTS — the adjustment loop as seen from the phone that started it.
// The backend now stamps every submission with its submitter (created_by),
// so this screen can filter to the signed-in user's own requests ("Mine",
// the default) or show the whole team's feed ("All") — who submitted each
// one is displayed either way. The screen LIVE-UPDATES: while the tab is
// open it polls every 15s, so an owner's approve/reject flips the badge on
// its own — pull-to-refresh is still there as the manual override.
const STATUS_META = {
  pending: { glyph: '⏳', label: 'Pending' },
  approved: { glyph: '✅', label: 'Approved' },
  rejected: { glyph: '❌', label: 'Rejected' },
};

// How often the open tab re-checks the server for decisions. Chosen for the
// demo (a decision lands within one breath) while staying polite to the
// Render free tier: one light request per 15s, only while the tab is on
// screen and the app is in the foreground.
const AUTO_REFRESH_MS = 15000;

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
  // 'mine' | 'all' — Mine (the signed-in staff member) is the default;
  // All shows the whole team's submissions with their submitter names.
  const [scope, setScope] = useState('mine');
  // Last successful server sync — shown under the scope chips so the live
  // behavior is visible at a glance.
  const [lastSynced, setLastSynced] = useState(null);
  // Re-entrancy guard: a Render cold start can take 30s+, so timer ticks can
  // overlap an in-flight request. Skip a tick rather than pile up requests.
  const inFlight = useRef(false);

  const fetchData = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!silent) setError('');
      const r = await listStockAdjustments();
      const list = Array.isArray(r) ? r : (r && r.data) || [];
      // Newest first (the endpoint returns insertion order; unshift puts new
      // rows at index 0, but sort defensively so the feed is always fresh-first).
      list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setRows(list);
      setLastSynced(new Date());
      // A successful silent poll also clears any stale error banner (retry
      // succeeded — the screen is healthy again). Same-value set bails out.
      setError((prev) => (prev ? '' : prev));
    } catch {
      // Silent (timer) polls keep the last good data on failure — a transient
      // blip or cold start must never blank the list or flash an error; the
      // next tick retries. Only user-driven loads surface the banner.
      if (!silent) setError('Could not load requests. Pull to refresh.');
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Live decision updates: fetch the moment the tab opens (covers the
  // submit-then-switch-tab demo beat), then poll while it stays focused.
  // The interval is cleared automatically when the tab loses focus, and
  // ticks are skipped while the app is backgrounded (no wasted battery or
  // data) or while a previous request is still in flight.
  useFocusEffect(
    useCallback(() => {
      fetchData();
      const timer = setInterval(() => {
        if (AppState.currentState !== 'active') return;
        fetchData(true);
      }, AUTO_REFRESH_MS);
      return () => clearInterval(timer);
    }, [fetchData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // Submitter match: id when the row carries one (server stamps it),
  // username fallback for legacy rows; rows with neither count as "unknown"
  // and only surface under All.
  const myId = getSessionUserId();
  const myName = getSessionUsername();
  const isMine = useCallback((r) => {
    if (myId != null && r.created_by_id != null) return Number(r.created_by_id) === Number(myId);
    if (r.created_by && myName) return String(r.created_by).toLowerCase() === String(myName).toLowerCase();
    return false;
  }, [myId, myName]);

  const visible = useMemo(
    () => (scope === 'mine' ? rows.filter(isMine) : rows),
    [rows, scope, isMine]
  );

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
          {visible.filter((r) => r.status === 'pending').length} pending ·{' '}
          {visible.filter((r) => r.status === 'approved').length} approved
        </Text>
        <View style={styles.scopeRow}>
          <TouchableOpacity
            style={[styles.scopeChip, scope === 'mine' && styles.scopeChipOn]}
            onPress={() => setScope('mine')}
            activeOpacity={0.8}
          >
            <Text style={[styles.scopeText, scope === 'mine' && styles.scopeTextOn]}>Mine</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scopeChip, scope === 'all' && styles.scopeChipOn]}
            onPress={() => setScope('all')}
            activeOpacity={0.8}
          >
            <Text style={[styles.scopeText, scope === 'all' && styles.scopeTextOn]}>All</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.syncNote}>
          {lastSynced
            ? `Live · updated ${lastSynced.toLocaleTimeString()} · checks every 15s`
            : 'Live · checks every 15s'}
        </Text>
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <FlatList
        data={visible}
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
                {item.created_by ? `submitted by ${item.created_by} · ` : ''}{formatDate(item.created_at)}
                {item.decided_at ? ` · decided ${formatDate(item.decided_at)}${item.decided_by ? ` by ${item.decided_by}` : ''}` : ''}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {scope === 'mine'
              ? 'No requests from you yet. Submit one from Scan or Count.'
              : 'No adjustment requests yet.'}
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
    scopeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    scopeChip: {
      paddingVertical: 6,
      paddingHorizontal: 16,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    scopeChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
    scopeText: { fontSize: 13, fontWeight: '800', color: colors.textSecondary },
    scopeTextOn: { color: '#fff' },
    syncNote: { fontSize: 10, color: colors.textSecondary, marginTop: 6, opacity: 0.8 },
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

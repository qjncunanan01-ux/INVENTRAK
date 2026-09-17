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
import { createStockAdjustment, getInventory, listLocations } from '../api';
import { useThemeColors } from '../theme-context';

// COUNT — the no-camera module. Search the live inventory, tap a product,
// enter the physical quantity per storage area, submit as PENDING
// adjustments the owner approves on the web admin. Pre-fills every field
// with the current system stock so a matching count is two taps.
export default function CountScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [data, setData] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  // Selected product + count form
  const [selected, setSelected] = useState(null); // inventory item
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  const [locIdByName, setLocIdByName] = useState({});

  const fetchData = useCallback(async () => {
    try {
      setError('');
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      setData({ locations: parsed.locations || [], items: parsed.items || [] });
    } catch {
      setError('Could not load inventory. Check the connection and pull to refresh.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    listLocations()
      .then((res) => {
        const list = Array.isArray(res) ? res : (res && res.data) || [];
        const map = {};
        list.forEach((l) => { if (l && l.id && l.name) map[l.name] = l.id; });
        setLocIdByName(map);
      })
      .catch(() => {});
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // In-stock items only on the browse list (counting a zero-everywhere
  // product is possible from the Scan screen via a tag; here search would
  // drown in 200 empty rows).
  const items = (data.items || []).filter((i) => {
    if (i.total <= 0) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (i.product?.name || '').toLowerCase().includes(q) ||
      (i.product?.category || '').toLowerCase().includes(q);
  });

  const openCount = (item) => {
    setSelected(item);
    const next = {};
    Object.keys(item.locations || {}).forEach((k) => { next[k] = item.locations[k]; });
    setCounts(next);
    setReason('');
    setSubmitMsg('');
    setSubmitErr('');
  };

  const submit = useCallback(async () => {
    if (!selected) return;
    const changes = Object.keys(selected.locations || {}).filter((loc) => {
      const current = Number(selected.locations[loc]) || 0;
      const next = Number(counts[loc]);
      return Number.isFinite(next) && next >= 0 && next !== current;
    });
    if (changes.length === 0) {
      setSubmitErr('No changes — enter a counted quantity that differs from the current stock.');
      setSubmitMsg('');
      return;
    }
    setSubmitBusy(true);
    setSubmitMsg('');
    setSubmitErr('');
    const failures = [];
    let done = 0;
    for (const loc of changes) {
      const locationId = locIdByName[loc];
      if (!locationId) { failures.push(loc); continue; }
      try {
        await createStockAdjustment({
          product_id: Number(selected.product.id),
          location_id: Number(locationId),
          new_qty: Number(counts[loc]),
          reason: reason.trim() || `Physical count at ${loc} (${selected.product.name})`,
        });
        done += 1;
      } catch {
        failures.push(loc);
      }
    }
    setSubmitBusy(false);
    if (done > 0) {
      setSubmitMsg(
        `${done} correction(s) submitted — the owner approves them on the web admin before stock updates.`
        + (failures.length > 0 ? ` Failed: ${failures.join(', ')}.` : '')
      );
      setReason('');
    } else {
      setSubmitErr('Could not submit corrections. Check the connection and try again.');
    }
  }, [selected, counts, reason, locIdByName]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (selected) {
    return (
      <View style={styles.container}>
        <View style={styles.selHead}>
          <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.selName} numberOfLines={1}>{selected.product?.name}</Text>
        </View>
        <Text style={styles.selSub}>
          Enter the actual counted quantity per storage area. Current system stock is shown
          beside each field.
        </Text>
        <View style={styles.formCard}>
          {Object.keys(selected.locations || {}).map((loc) => (
            <View key={loc} style={styles.countRow}>
              <Text style={styles.countLoc} numberOfLines={1}>{loc}</Text>
              <TextInput
                style={styles.countInput}
                keyboardType="decimal-pad"
                value={counts[loc] !== undefined ? String(counts[loc]) : ''}
                onChangeText={(v) => setCounts({ ...counts, [loc]: v.replace(/[^0-9.]/g, '') })}
                placeholder="Qty"
                placeholderTextColor={colors.textSecondary}
              />
              <Text style={styles.countCurrent}>sys: {selected.locations[loc] ?? 0}</Text>
            </View>
          ))}
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitBusy} activeOpacity={0.85}>
            <Text style={styles.submitText}>
              {submitBusy ? 'Submitting…' : 'Submit for approval'}
            </Text>
          </TouchableOpacity>
          {submitMsg ? <Text style={styles.ok}>{submitMsg}</Text> : null}
          {submitErr ? <Text style={styles.err}>{submitErr}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Physical Count</Text>
        <Text style={styles.subtitle}>
          {data.items.length} products · {data.locations.length} storage area(s)
        </Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.product?.id ?? item.product?.name)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />
        }
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => openCount(item)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{item.product?.name}</Text>
              <Text style={styles.rowMeta}>
                {Object.entries(item.locations || {})
                  .filter(([, v]) => Number(v) > 0)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ') || 'No stock recorded'}
              </Text>
            </View>
            <Text style={styles.rowTotal}>{item.total}</Text>
            <Text style={styles.rowCta}>Count ›</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No products match. Pull down to refresh.</Text>
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
    searchInput: {
      marginTop: 12,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      color: colors.textPrimary,
      fontSize: 15,
    },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 6,
    },
    rowName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    rowMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    rowTotal: {
      color: colors.textPrimary,
      fontWeight: '800',
      fontSize: 15,
      marginLeft: 8,
      minWidth: 34,
      textAlign: 'right',
    },
    rowCta: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13, marginLeft: 10 },
    empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 13 },
    err: { color: colors.error, fontSize: 12, paddingHorizontal: 16, marginBottom: 6, lineHeight: 17 },
    // selected / form
    selHead: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 14,
      gap: 10,
    },
    back: { color: colors.brandPrimary, fontWeight: '800', fontSize: 15 },
    selName: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    selSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, paddingHorizontal: 16, marginTop: 6 },
    formCard: {
      margin: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1.5,
      borderColor: colors.brandPrimary,
    },
    countRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    countLoc: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary, paddingRight: 8 },
    countInput: {
      width: 74,
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
    },
    countCurrent: { fontSize: 11, color: colors.textSecondary, marginLeft: 8, width: 52 },
    reasonInput: {
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 14,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
      marginBottom: 10,
    },
    submitBtn: {
      backgroundColor: colors.brandSecondary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    ok: { color: colors.success, fontSize: 12, marginTop: 8, lineHeight: 17 },
  });

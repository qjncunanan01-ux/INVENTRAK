import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { createShelfCounts, getShelfStocktake, listLocations } from '../api';
import { useThemeColors } from '../theme-context';

// STOCKTAKE — walk a shelf with a phone in your hand.
//
// This is deliberately NOT the Count tab. Counting there is PRODUCT-first: you
// know which product you are looking at and want to record it. Standing in
// front of a shelf is SHELF-first: you can see what is there, not what it is
// called, and you want to go down the rows. Both stay, because both are real
// jobs — this one is for the walk, the Count tab for the single lookup.
//
// The screen mirrors the server's rule rather than inventing its own: a shelf
// counts as re-counted only when EVERY line on it has a fresh count, so the
// progress bar says "42 of 204 lines" and never "done" until it really is.
// Counting one row and walking away is allowed — that is what happens when a
// shift ends — and the shelf simply stays due.
//
// Deliberately uses POST /api/inventory/counts rather than the CountCard's
// pending-adjustment path. An adjustment waits for approval, so it would never
// clear a shelf or feed the reconciliation report; this writes real counts, and
// the whole walk goes up in ONE request. 200 round-trips over a phone
// connection is not a stocktake, and a failure halfway would leave the shelf
// looking half-walked.
export default function StocktakeScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [locations, setLocations] = useState([]);
  const [shelf, setShelf] = useState(null); // full ShelfStocktake payload
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // product_id -> the quantity typed at the shelf, as TEXT. Text, because a
  // number input that rewrites itself mid-keystroke is the classic way a
  // counter loses a digit; empty stays empty until someone types.
  const [entered, setEntered] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const loadShelves = useCallback(async () => {
    try {
      setError('');
      const r = await listLocations();
      const list = (r && r.data ? r.data : r) || [];
      setLocations(Array.isArray(list) ? list : []);
    } catch {
      setError('Could not load storage areas. Check the connection and pull to refresh.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const openShelf = useCallback(async (id) => {
    setLoading(true);
    setMsg('');
    setErr('');
    try {
      const r = await getShelfStocktake({ id });
      setShelf((r && r.data ? r.data : r) || null);
      setEntered({});
    } catch (e) {
      setErr((e && e.message) || 'Could not open that shelf.');
      setShelf(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadShelves(); }, [loadShelves]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (shelf) openShelf(shelf.location_id);
    else loadShelves();
  }, [shelf, openShelf, loadShelves]);

  const lines = (shelf && shelf.lines) || [];
  const summary = (shelf && shelf.summary) || null;

  // What has been typed but not yet sent. A blank field is skipped rather than
  // sent as zero — "I did not look at this row" and "there is nothing here"
  // are different answers and must not be collapsed into one number.
  const staged = useMemo(
    () =>
      Object.keys(entered)
        .map((id) => ({ product_id: Number(id), counted_qty: entered[id] }))
        .filter((r) => r.counted_qty !== '' && Number.isFinite(Number(r.counted_qty)) && Number(r.counted_qty) >= 0),
    [entered],
  );

  const setQty = (productId, value) => {
    // Digits and a single dot only — strip anything a shelf label cannot
    // produce, so the server never has to reject a typo mid-walk.
    const cleaned = value.replace(/[^0-9.]/g, '');
    setEntered((prev) => ({ ...prev, [productId]: cleaned }));
    setMsg('');
    setErr('');
  };

  const save = useCallback(async () => {
    if (!shelf || staged.length === 0) return;
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const res = await createShelfCounts({ location_id: shelf.location_id, counts: staged });
      const body = (res && res.data ? res.data : res) || {};
      const remaining = body.shelf ? body.shelf.lines_remaining : null;
      setEntered({});
      // Reload FIRST, then report. openShelf clears the notice area on entry,
      // so setting the message before the refresh wiped the confirmation the
      // counter had just earned — the walk appeared to have done nothing.
      await openShelf(shelf.location_id);
      setMsg(
        `Recorded ${body.recorded} line${body.recorded === 1 ? '' : 's'}.` +
        (remaining === 0
          ? ' This shelf is fully re-counted.'
          : ` ${remaining} line${remaining === 1 ? '' : 's'} still to walk on this shelf.`),
      );
    } catch (e) {
      const details = e && e.body && Array.isArray(e.body.details) ? e.body.details.join(' · ') : null;
      setErr(details || (e && e.message) || 'Could not save the walk. Your entries are still here — try again.');
    } finally {
      setSaving(false);
    }
  }, [shelf, staged, openShelf]);

  if (loading && !shelf) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  // ---- shelf picker -------------------------------------------------------
  if (!shelf) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Stocktake</Text>
          <Text style={styles.subtitle}>Pick the shelf you are standing at.</Text>
        </View>
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <FlatList
          data={locations}
          keyExtractor={(l) => String(l.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openShelf(item.id)} activeOpacity={0.7}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowCta}>Walk ›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No storage areas yet.</Text>}
        />
      </View>
    );
  }

  // ---- the walk -----------------------------------------------------------
  const pct = summary && summary.total_lines ? Math.round((summary.fresh_lines / summary.total_lines) * 100) : 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { setShelf(null); setEntered({}); }} hitSlop={10}>
          <Text style={styles.back}>‹ All shelves</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{shelf.location}</Text>
        <Text style={styles.subtitle}>
          {summary.fresh_lines} of {summary.total_lines} lines re-counted
          {summary.lines_remaining > 0 ? ` · ${summary.lines_remaining} to walk` : ' · complete'}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
      </View>

      {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      {err ? <Text style={styles.err}>{err}</Text> : null}

      <FlatList
        data={lines}
        keyExtractor={(l) => String(l.product_id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.brandPrimary]} />
        }
        renderItem={({ item }) => {
          const value = entered[item.product_id] ?? '';
          const dirty = value !== '';
          const flag =
            item.state === 'fresh' ? styles.ok : item.state === 'stale' ? styles.warn : styles.muted;
          const when =
            item.state === 'never'
              ? 'never counted'
              : item.state === 'fresh'
                ? `counted ${item.days_since_count}d ago`
                : `counted ${item.days_since_count}d ago — due`;
          return (
            <View style={styles.line}>
              <View style={styles.lineText}>
                <Text style={styles.lineName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.lineMeta}>
                  system says {item.system_qty} · <Text style={flag}>{when}</Text>
                </Text>
              </View>
              <TextInput
                style={[styles.qty, dirty && styles.qtyDirty]}
                value={value}
                onChangeText={(v) => setQty(item.product_id, v)}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel={`Counted quantity for ${item.name}`}
              />
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.save, staged.length === 0 && styles.saveDisabled]}
              onPress={save}
              disabled={saving || staged.length === 0}
              activeOpacity={0.8}
            >
              <Text style={styles.saveText}>
                {saving
                  ? 'Saving…'
                  : staged.length === 0
                    ? 'Enter a quantity to save'
                    : `Record ${staged.length} line${staged.length === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>
            <Text style={styles.note}>
              Only the rows you filled in are sent. Blank rows are skipped — leaving one blank
              is not the same as recording a zero.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing is stocked on this shelf, so there is nothing to walk.</Text>
        }
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
    title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    back: { color: colors.brandPrimary, fontWeight: '800', fontSize: 14 },
    track: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.surface,
      marginTop: 10,
      overflow: 'hidden',
    },
    fill: { height: 8, backgroundColor: colors.brandPrimary },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 12,
      marginBottom: 6,
    },
    rowName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, flex: 1 },
    rowCta: { color: colors.brandPrimary, fontWeight: '800', fontSize: 13, marginLeft: 10 },
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 6,
    },
    lineText: { flex: 1, paddingRight: 10 },
    lineName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    lineMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    qty: {
      minWidth: 66,
      textAlign: 'center',
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    qtyDirty: { borderWidth: 2, borderColor: colors.brandPrimary },
    save: {
      backgroundColor: colors.brandPrimary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 10,
    },
    saveDisabled: { opacity: 0.4 },
    saveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    footer: { paddingTop: 4 },
    note: { color: colors.textSecondary, fontSize: 11, marginTop: 10, lineHeight: 16 },
    ok: { color: colors.success, fontSize: 12, paddingHorizontal: 16, paddingBottom: 6, lineHeight: 17 },
    err: { color: colors.error, fontSize: 12, paddingHorizontal: 16, paddingBottom: 6, lineHeight: 17 },
    empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 13 },
    muted: { color: colors.textSecondary },
    warn: { color: '#b45309', fontWeight: '700' },
  });
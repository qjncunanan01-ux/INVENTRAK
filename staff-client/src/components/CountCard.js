import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createStockAdjustment, listLocations } from '../api';
import { useThemeColors } from '../theme-context';

// CountCard — the shared "verify & record physical count" form used by BOTH
// scan modules (QR tag scan and label OCR). One product in focus, one input
// per storage area, one submit that creates a PENDING adjustment per changed
// location. Kept as a component so the two scan modules stay separate while
// submitting through exactly the same logic.
export default function CountCard({ focus, onClear }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  const [locIdByName, setLocIdByName] = useState({});

  // Initialize the form from the focused product whenever it changes.
  const focusKey = `${focus?.id}:${JSON.stringify(focus?.stock?.locations || {})}`;
  const [initializedFor, setInitializedFor] = useState(null);
  if (focus && initializedFor !== focusKey) {
    setInitializedFor(focusKey);
    const next = {};
    Object.keys(focus.stock?.locations || {}).forEach((k) => { next[k] = focus.stock.locations[k]; });
    setCounts(next);
    setReason('');
    setSubmitMsg('');
    setSubmitErr('');
  }

  // Location name -> id map (the adjustment endpoint needs location_id).
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

  const submit = useCallback(async () => {
    if (!focus) return;
    const changes = Object.keys(focus.stock?.locations || {}).filter((loc) => {
      const current = Number(focus.stock.locations[loc]) || 0;
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
          product_id: Number(focus.id),
          location_id: Number(locationId),
          new_qty: Number(counts[loc]),
          reason: reason.trim() || `Physical count from scan of ${focus.name}`,
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
      setSubmitErr('Could not submit corrections. Check the product/locations and try again.');
    }
  }, [focus, counts, reason, locIdByName]);

  if (!focus) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Verify & record physical count</Text>
      <Text style={styles.sub}>
        Confirm this is <Text style={styles.strong}>{focus.name}</Text>, enter the actual counted
        quantity per location, and submit. Each change becomes a PENDING adjustment the owner
        approves before stock updates.
      </Text>
      <View>
        {Object.keys(focus.stock?.locations || {}).map((loc) => (
          <View key={loc} style={styles.row}>
            <Text style={styles.loc} numberOfLines={1}>{loc}</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={counts[loc] !== undefined ? String(counts[loc]) : ''}
              onChangeText={(v) => setCounts({ ...counts, [loc]: v.replace(/[^0-9.]/g, '') })}
              placeholder="Qty"
              placeholderTextColor={colors.textSecondary}
            />
            <Text style={styles.current}>cur: {focus.stock.locations[loc] ?? 0}</Text>
          </View>
        ))}
      </View>
      <TextInput
        style={styles.reasonInput}
        value={reason}
        onChangeText={setReason}
        placeholder="Reason (optional)"
        placeholderTextColor={colors.textSecondary}
      />
      <TouchableOpacity style={styles.btn} onPress={submit} disabled={submitBusy} activeOpacity={0.85}>
        <Text style={styles.btnText}>{submitBusy ? 'Submitting…' : 'Submit corrections for approval'}</Text>
      </TouchableOpacity>
      {submitMsg ? <Text style={styles.ok}>{submitMsg}</Text> : null}
      {submitErr ? <Text style={styles.err}>{submitErr}</Text> : null}
      {onClear ? (
        <TouchableOpacity onPress={onClear} hitSlop={8}>
          <Text style={styles.dismiss}>Clear this count</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    card: {
      marginTop: 4,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1.5,
      borderColor: colors.brandSecondary,
    },
    title: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    sub: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginTop: 4 },
    strong: { fontWeight: '800', color: colors.textPrimary },
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 4 },
    loc: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary, paddingRight: 8 },
    input: {
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
    current: { fontSize: 11, color: colors.textSecondary, marginLeft: 8, width: 52 },
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
      marginTop: 6,
    },
    btn: {
      backgroundColor: colors.brandSecondary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    ok: { color: colors.success, fontSize: 12, marginTop: 8, lineHeight: 17 },
    err: { color: colors.error, fontSize: 12, marginTop: 8, lineHeight: 17 },
    dismiss: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 10 },
  });

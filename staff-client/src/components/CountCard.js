import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createStockAdjustment, listLocations } from '../api';
import { useThemeColors } from '../theme-context';

// CountCard — the shared "verify & record physical count" form used by BOTH
// scan module (QR tag scan) AND the Count module. One product
// in focus, one input per storage area, an optional best-before date read off
// the label, and one submit that creates a PENDING adjustment per changed
// location (the best-before travels on every row it belongs to). On approval
// the expiry becomes the reset lot's expiry_date, so FEFO consumption and
// best-before alerts track the stock automatically.
export default function CountCard({ focus, onClear }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  // Best-before date read off the label during the count (YYYY-MM-DD). One
  // date per submission: it is stamped on every adjustment row created by
  // this submission (a single label read applies to the whole batch).
  const [bestBefore, setBestBefore] = useState('');
  const [bestBeforeErr, setBestBeforeErr] = useState('');
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
    setBestBefore('');
    setBestBeforeErr('');
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
    // Best-before is OPTIONAL, but a malformed one never submits — the
    // backend enforces strict ISO YYYY-MM-DD (a real calendar date), and the
    // same check client-side gives instant feedback.
    let expiry = null;
    const bb = bestBefore.trim();
    if (bb) {
      const asDate = new Date(`${bb}T00:00:00Z`);
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(bb) && !Number.isNaN(asDate.getTime()) && asDate.toISOString().slice(0, 10) === bb;
      if (!valid) {
        setBestBeforeErr('Use a real date in YYYY-MM-DD format (e.g. 2027-03-15).');
        return;
      }
      expiry = bb;
    }
    setBestBeforeErr('');
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
          expiry_date: expiry,
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
  }, [focus, counts, reason, bestBefore, locIdByName]);

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
      {/* Best-before capture: read the date off the label during the count.
          Optional, but validated (YYYY-MM-DD, real calendar date) on both the
          phone and the server. Becomes the stock lot's expiry on approval. */}
      <Text style={styles.fieldLabel}>Best before (optional)</Text>
      <TextInput
        style={styles.dateInput}
        value={bestBefore}
        onChangeText={(v) => { setBestBefore(v); setBestBeforeErr(''); }}
        placeholder="YYYY-MM-DD — e.g. 2027-03-15"
        placeholderTextColor={colors.textSecondary}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      {bestBeforeErr ? <Text style={styles.err}>{bestBeforeErr}</Text> : null}
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
    fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginTop: 8, marginBottom: 6 },
    dateInput: {
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
      marginBottom: 2,
    },
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  createScanEvent,
  createStockAdjustment,
  getInventory,
  imageUrl,
  listLocations,
  ocrStockCheck,
} from '../api';
import { useThemeColors } from '../theme-context';

// SCAN hub — one screen, two work flows:
//
//   1. QR / barcode tag scan (live camera): location tags open a storage
//      area's stock inline; product tags jump to that product's count card.
//   2. Label photo (OCR): snap or pick a product label; the backend fuzzy-
//      matches the catalog and returns per-location stock, feeding the
//      verify-and-count form directly.
//
// Both flows end at the same place: a count card the operator fills and
// submits as a PENDING adjustment.

// Same payload grammar as the admin's printed tags (and the customer app's
// scanner, which is where these components were proven out):
//   INVENTRAK:LOC:<id>:<name> | INVENTRAK:PROD:<id> | bare number = product id
function parseQr(data) {
  const raw = String(data || '').trim();
  const locMatch = raw.match(/^INVENTRAK:LOC:(\d+):(.+)$/i);
  if (locMatch) {
    let name = locMatch[2];
    try { name = decodeURIComponent(name); } catch { /* keep the raw value */ }
    return { kind: 'location', id: Number(locMatch[1]), name, raw };
  }
  const prodMatch = raw.match(/^INVENTRAK:PROD:(\d+)$/i);
  if (prodMatch) {
    return { kind: 'product', id: Number(prodMatch[1]), raw };
  }
  if (/^\d+$/.test(raw)) {
    return { kind: 'product', id: Number(raw), raw };
  }
  return { kind: 'unknown', id: null, raw };
}

// Minimum gap between two accepted scans: onBarcodeScanned fires per frame
// while a tag is in view, so without this one tag fires a dozen times.
const RESCAN_COOLDOWN_MS = 1500;

// Strong auto-pick rule for OCR matches (same numbers as the admin scanner):
// high absolute score AND a healthy gap to the runner-up.
const STRONG_SCORE = 0.75;
const STRONG_GAP = 0.2;

export default function ScanScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // last decoded payload (unknown case)
  const [mode, setMode] = useState('qr'); // 'qr' | 'ocr'

  // OCR state
  const [image, setImage] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [ocrMatches, setOcrMatches] = useState([]);
  const [ocrError, setOcrError] = useState('');

  // Count form (shared by both flows): the focused product + per-location qty
  const [focus, setFocus] = useState(null); // { id, name, stock: { locations: {...} } }
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  const [locIdByName, setLocIdByName] = useState({});

  // Location name → id map (the adjustment endpoint wants location_id).
  useEffect(() => {
    listLocations()
      .then((data) => {
        const list = Array.isArray(data) ? data : (data && data.data) || [];
        const map = {};
        list.forEach((l) => { if (l && l.id && l.name) map[l.name] = l.id; });
        setLocIdByName(map);
      })
      .catch(() => {});
  }, []);

  // Synchronous scan lock: onBarcodeScanned can fire several times inside one
  // frame, before React re-renders with busy=true.
  const lockRef = useRef(false);
  // Re-arm the camera lock when the screen regains focus.
  useFocusEffect(
    useMemo(() => () => {
      lockRef.current = false;
      setBusy(false);
    }, [])
  );

  // Inventory fallback for product-tag scans: the tag gives only an id, so
  // pull the item's live per-location stock straight from /api/inventory.
  const focusProductById = useCallback(async (id) => {
    try {
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      const item = (parsed.items || []).find(
        (i) => Number(i.product?.id) === Number(id)
      );
      if (!item) {
        Alert.alert('Not in stock view', 'That product has no stock record yet — use a label photo instead.');
        return;
      }
      setFocus({ id: item.product.id, name: item.product.name, stock: { locations: item.locations || {} } });
      const next = {};
      Object.keys(item.locations || {}).forEach((k) => { next[k] = item.locations[k]; });
      setCounts(next);
      setReason('');
      setSubmitMsg('');
      setSubmitErr('');
    } catch {
      Alert.alert('Offline', 'Could not load stock for that tag. Pull to retry.');
    }
  }, []);

  // Location-tag scan: show that storage area's stock inline (no navigation —
  // one screen, everything at hand).
  const [locView, setLocView] = useState(null); // { name, rows: [{name, total}] }
  const focusLocationByName = useCallback(async (name) => {
    try {
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      const rows = (parsed.items || [])
        .filter((i) => (i.locations || {})[name] !== undefined)
        .map((i) => ({ id: i.product?.id, name: i.product?.name || '?', total: i.locations[name] || 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setLocView({ name, rows });
    } catch {
      Alert.alert('Offline', 'Could not load that location. Pull to retry.');
    }
  }, []);

  const handleScan = ({ data }) => {
    if (busy || lockRef.current) return;
    const parsed = parseQr(data);
    // Audit every scan (recognized or not) — fire-and-forget, never blocks.
    createScanEvent({
      payload: parsed.raw,
      kind: parsed.kind,
      target_id: parsed.kind === 'unknown' ? null : parsed.id,
      location: parsed.kind === 'location' ? parsed.name : null,
    }).catch(() => {});

    if (parsed.kind === 'location') {
      lockRef.current = true;
      setBusy(true);
      focusLocationByName(parsed.name).finally(() => {
        setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
      });
      return;
    }
    if (parsed.kind === 'product') {
      lockRef.current = true;
      setBusy(true);
      focusProductById(parsed.id).finally(() => {
        setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
      });
      return;
    }
    // Unrecognized tag — say so instead of staying silent, then re-arm.
    lockRef.current = true;
    setLast({ raw: String(data || '').slice(0, 120) });
    Alert.alert(
      'Tag not recognized',
      'This QR code is not an INVENTRAK location or product tag. Only tags generated by the system can be scanned.'
    );
    setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
  };

  // ---- OCR flow ----
  const pickImage = async (useCamera) => {
    setOcrError('');
    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Camera access is required to scan a product label.');
        return;
      }
    }
    try {
      // allowsEditing stays OFF: the built-in crop editor renders black on
      // several Android devices, and the backend reads the whole label.
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.8 });
      if (result.canceled || !result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      if (!asset.uri) return;
      setImage(asset.uri);
      setOcrMatches([]);
      setOcrText('');

      // Same preprocessing recipe as the admin scanner: ~1600px, grayscale,
      // contrast boost — glossy labels defeat raw tesseract.
      let payload;
      try {
        const processed = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1600 } }, { grayscale: {} }, { contrast: 1.6 }],
          { base64: true, compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        payload = processed.base64 || asset.base64;
      } catch {
        payload = asset.base64;
      }
      if (!payload) return;

      setBusy(true);
      try {
        const data = await ocrStockCheck(asset.fileName ? { image: payload, filename: asset.fileName } : { image: payload });
        const list = Array.isArray(data.matches) ? data.matches : [];
        setOcrText(data.text || '');
        if (list.length === 0) {
          setOcrError(
            !data.text || !data.text.trim()
              ? 'No text recognized. Try a clearer, well-lit photo of the label.'
              : 'No SYLVER product detected — this label doesn\u2019t match anything in the catalog.'
          );
          return;
        }
        // Strong single match → straight into the count form (the whole point
        // of the staff flow); ambiguous → pick from the list.
        const top = list[0];
        const second = list[1];
        if (top.score >= STRONG_SCORE && (!second || top.score - second.score >= STRONG_GAP)) {
          applyFocus(top);
        }
      } catch (err) {
        setOcrError(err.message || 'OCR failed. Is the backend reachable?');
      } finally {
        setBusy(false);
      }
    } catch {
      setOcrError('Could not open the camera / photo library.');
    }
  };

  // Focus the count form on a product (from OCR match or product tag).
  const applyFocus = (m) => {
    setFocus({ id: Number(m.id), name: m.name, stock: m.stock || { locations: {} } });
    const next = {};
    Object.keys(m.stock?.locations || {}).forEach((k) => { next[k] = m.stock.locations[k]; });
    setCounts(next);
    setReason('');
    setSubmitMsg('');
    setSubmitErr('');
  };

  // ---- Submit: one pending adjustment per changed location ----
  const submitCount = useCallback(async () => {
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

  // ---- Permission gates (QR mode needs the camera) ----
  if (mode === 'qr' && !permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }
  if (mode === 'qr' && !permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.lockGlyph}>📷</Text>
        <Text style={styles.lockTitle}>Camera access needed</Text>
        <Text style={styles.lockBody}>
          Scanning tags uses the camera to read the tag you point it at.
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Mode switch */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'qr' && styles.modeBtnOn]}
          onPress={() => setMode('qr')}
          activeOpacity={0.85}
        >
          <Text style={[styles.modeText, mode === 'qr' && styles.modeTextOn]}>▦ QR / barcode</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'ocr' && styles.modeBtnOn]}
          onPress={() => setMode('ocr')}
          activeOpacity={0.85}
        >
          <Text style={[styles.modeText, mode === 'ocr' && styles.modeTextOn]}>📷 Label OCR</Text>
        </TouchableOpacity>
      </View>

      {mode === 'qr' ? (
        <View style={styles.cameraCard}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'codabar', 'pdf417'] }}
            onBarcodeScanned={handleScan}
          />
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>Point at a QR or barcode tag</Text>
            <Text style={styles.overlaySub}>
              Location tags show that storage area's stock; product tags open its count card. Every scan is logged.
            </Text>
          </View>
        </View>
      ) : (
        <View>
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => pickImage(true)} disabled={busy}>
              <Text style={styles.btnPrimaryText}>📷 Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => pickImage(false)} disabled={busy}>
              <Text style={styles.btnGhostText}>🖼 Upload</Text>
            </TouchableOpacity>
          </View>
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator size="large" color={colors.brandPrimary} />
              <Text style={styles.busyText}>Reading label...</Text>
            </View>
          ) : null}
          {image ? <Image source={{ uri: image }} style={styles.preview} resizeMode="cover" /> : null}
          {ocrError ? <Text style={styles.error}>{ocrError}</Text> : null}
          {ocrText && ocrText.trim() ? (
            <View style={styles.textCard}>
              <Text style={styles.textCardTitle}>Recognized (used for matching)</Text>
              <Text style={styles.recognized}>{ocrText.trim().slice(0, 300)}</Text>
            </View>
          ) : null}
          {ocrMatches.length > 0 ? (
            <View>
              <Text style={styles.sectionTitle}>Matches — tap to count</Text>
              {ocrMatches.map((m, idx) => (
                <TouchableOpacity
                  key={m.id ?? m.name ?? idx}
                  style={styles.matchCard}
                  onPress={() => applyFocus(m)}
                  activeOpacity={0.7}
                >
                  {m.image ? (
                    <Image source={{ uri: imageUrl(m.image) }} style={styles.matchThumb} resizeMode="cover" />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.matchName}>{m.name}</Text>
                    <Text style={styles.matchMeta}>{(m.score * 100).toFixed(0)}% match</Text>
                  </View>
                  <Text style={styles.matchCta}>Count ›</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {/* Location-tag result: that storage area's stock, inline */}
      {locView ? (
        <View style={styles.locCard}>
          <View style={styles.locCardHead}>
            <Text style={styles.sectionTitle}>Stock at {locView.name}</Text>
            <TouchableOpacity onPress={() => setLocView(null)} hitSlop={8}>
              <Text style={styles.locClear}>✕</Text>
            </TouchableOpacity>
          </View>
          {locView.rows.length === 0 ? (
            <Text style={styles.emptyNote}>No stock recorded at this location.</Text>
          ) : (
            locView.rows.map((r) => (
              <View key={`${r.id ?? r.name}`} style={styles.locRow}>
                <Text style={styles.locName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.locQty}>{r.total}</Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {/* Count card — the shared destination of both flows */}
      {focus ? (
        <View style={styles.countCard}>
          <Text style={styles.countTitle}>Verify & record physical count</Text>
          <Text style={styles.countSub}>
            Confirm this is <Text style={styles.countStrong}>{focus.name}</Text>, enter the actual
            counted quantity per location, and submit. Each change becomes a PENDING adjustment the
            owner approves before stock updates.
          </Text>
          <View style={styles.countRows}>
            {Object.keys(focus.stock?.locations || {}).map((loc) => (
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
                <Text style={styles.countCurrent}>cur: {focus.stock.locations[loc] ?? 0}</Text>
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
          <TouchableOpacity style={styles.countBtn} onPress={submitCount} disabled={submitBusy} activeOpacity={0.85}>
            <Text style={styles.countBtnText}>
              {submitBusy ? 'Submitting…' : 'Submit corrections for approval'}
            </Text>
          </TouchableOpacity>
          {submitMsg ? <Text style={styles.countOk}>{submitMsg}</Text> : null}
          {submitErr ? <Text style={styles.countErr}>{submitErr}</Text> : null}
          <TouchableOpacity onPress={() => setFocus(null)} hitSlop={8}>
            <Text style={styles.countDismiss}>Clear this count</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {last && mode === 'qr' ? (
        <Text style={styles.unknownNote}>Last scan: “{last.raw}” — not an INVENTRAK tag</Text>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.background },
    modeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    modeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    modeBtnOn: { borderColor: colors.workAccent, backgroundColor: colors.surface },
    modeText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    modeTextOn: { color: colors.workAccent },
    cameraCard: { borderRadius: 14, overflow: 'hidden', marginBottom: 14 },
    camera: { height: 300 },
    overlay: {
      position: 'absolute',
      left: 10,
      right: 10,
      top: 10,
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    overlayTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
    overlaySub: { color: 'rgba(255,255,255,0.85)', fontSize: 11, textAlign: 'center', marginTop: 3, lineHeight: 15 },
    btnRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    btn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    btnPrimary: { backgroundColor: colors.brandPrimary },
    btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    btnGhost: { borderWidth: 1.5, borderColor: colors.brandPrimary },
    btnGhostText: { color: colors.brandPrimary, fontSize: 14, fontWeight: '700' },
    busy: { alignItems: 'center', paddingVertical: 18 },
    busyText: { marginTop: 8, color: colors.textSecondary, fontSize: 13 },
    preview: { width: '100%', height: 180, borderRadius: 12, marginBottom: 12, backgroundColor: colors.surface },
    error: { color: colors.error, fontSize: 13, marginBottom: 10, lineHeight: 18 },
    textCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
    textCardTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
    recognized: { color: colors.textPrimary, fontSize: 13, lineHeight: 19 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
    matchCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    matchThumb: { width: 44, height: 44, borderRadius: 8, marginRight: 12, backgroundColor: colors.background },
    matchName: { fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
    matchMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    matchCta: { color: colors.workAccent, fontWeight: '800', fontSize: 14 },
    locCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1.5,
      borderColor: colors.brandSecondary,
    },
    locCardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    locClear: { color: colors.textSecondary, fontSize: 15, padding: 4 },
    locRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    locName: { flex: 1, fontSize: 13, color: colors.textPrimary, fontWeight: '600', paddingRight: 8 },
    locQty: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
    emptyNote: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    // ---- count card ----
    countCard: {
      marginTop: 4,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1.5,
      borderColor: colors.workAccent,
    },
    countTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    countSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginTop: 4 },
    countStrong: { fontWeight: '800', color: colors.textPrimary },
    countRows: { marginTop: 10 },
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
    countBtn: {
      backgroundColor: colors.brandSecondary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    countBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    countOk: { color: colors.success, fontSize: 12, marginTop: 8, lineHeight: 17 },
    countErr: { color: colors.error, fontSize: 12, marginTop: 8, lineHeight: 17 },
    countDismiss: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 10 },
    unknownNote: { color: colors.textSecondary, fontSize: 12, marginTop: 10, textAlign: 'center' },
    lockGlyph: { fontSize: 44, marginBottom: 12 },
    lockTitle: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    lockBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8, marginBottom: 20 },
  });

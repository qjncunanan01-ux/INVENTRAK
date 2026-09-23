import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  createScanEvent,
  createStockAdjustment,
  getProductByQr,
  listLocations,
  STAFF_TOOLS_ROLES,
  useSessionRole,
  useSessionUsername,
} from '../api';
import { useThemeColors } from '../theme-context';

// QR SCANNER — the product-identification surface of the mobile app.
// (The old OCR photo workflow is retired: a printed tag now identifies the
// product deterministically — no camera-to-text recognition, no fuzzy match.)
//
//   Scan QR → decode identifier → GET /api/products/qr/:code → product
//
// Payloads this scanner understands:
//   - INVENTRAK:PROD:<id>  — a product tag printed by the admin; the id (or
//     SKU / bare number) resolves server-side to exactly one catalog product.
//   - INVENTRAK:LOC:<id>:<name> — a storage-area tag; opens that location's
//     stock availability view.
//   - a bare number        — legacy barcode fallback (product id).
// Anything else is reported as unrecognized instead of silently ignored.
//
// Roles:
//   - Customers/members: scan → the product detail page (browse & order).
//   - Staff/admin: scan → product + live per-location stock → verify the
//     physical count → submit PENDING adjustments the owner approves. The QR
//     authorizes nothing and never writes stock on its own.

// Minimum gap between two accepted scans. onBarcodeScanned fires on every
// camera frame while a code is in view, so without this a single tag can fire
// a dozen times (double navigation, a stack of "not recognized" alerts).
const RESCAN_COOLDOWN_MS = 1500;

function parseQr(data) {
  const raw = String(data || '').trim();
  const locMatch = raw.match(/^INVENTRAK:LOC:(\d+):(.+)$/i);
  if (locMatch) {
    let name = locMatch[2];
    try { name = decodeURIComponent(name); } catch { /* keep the raw value */ }
    return { kind: 'location', id: Number(locMatch[1]), name, raw };
  }
  const prodMatch = raw.match(/^INVENTRAK:PROD:(.+)$/i);
  if (prodMatch) {
    return { kind: 'product', code: prodMatch[1].trim(), id: /^\d+$/.test(prodMatch[1]) ? Number(prodMatch[1]) : null, raw };
  }
  if (/^\d+$/.test(raw)) {
    return { kind: 'product', code: raw, id: Number(raw), raw };
  }
  return { kind: 'unknown', id: null, code: raw, raw };
}

export default function QrScanScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isLoggedIn = !!useSessionUsername(null);
  // Staff/admin accounts get the verify-and-record flow after a scan: the
  // physical count is submitted as a PENDING adjustment the owner approves.
  const role = useSessionRole();
  const isStaff = isLoggedIn && STAFF_TOOLS_ROLES.includes(role);

  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [last, setLast] = useState(null); // { type:'unknown'|'miss', raw } for the footer note
  // Staff verify-and-record state (mirrors the admin Scan & Stock page).
  const [product, setProduct] = useState(null); // QrProductLookup payload
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  // Location name -> id map (the adjustment endpoint needs location_id; the
  // stock snapshot is keyed by name for display).
  const [locIdByName, setLocIdByName] = useState({});

  // Staff need location ids to submit counts; fetch once (staff only).
  useEffect(() => {
    if (!isStaff) return;
    listLocations()
      .then((data) => {
        const list = Array.isArray(data) ? data : (data && data.data) || [];
        const map = {};
        list.forEach((l) => { if (l && l.id && l.name) map[l.name] = l.id; });
        setLocIdByName(map);
      })
      .catch(() => {});
  }, [isStaff]);

  // Synchronous lock: onBarcodeScanned can fire several times inside one
  // frame, before React has re-rendered with busy=true. The ref closes that
  // window so a tag can never navigate twice, and the cooldown stops the
  // camera from re-triggering on the same code still in view.
  const lockRef = useRef(false);

  // Re-arm the scanner whenever the screen regains focus (after navigating
  // to a product/location and coming back, a new tag can be scanned).
  useFocusEffect(
    useMemo(() => () => {
      lockRef.current = false;
      setBusy(false);
    }, []),
  );

  // Reset the count form whenever a new product lands.
  useEffect(() => {
    if (!isStaff || !product) return;
    const next = {};
    Object.keys(product.stock?.locations || {}).forEach((k) => {
      next[k] = product.stock.locations[k];
    });
    setCounts(next);
    setReason('');
    setSubmitMsg('');
    setSubmitErr('');
  }, [isStaff, product]);

  // Staff submit: for every location whose counted qty differs from the
  // current stock, create a pending adjustment (owner approves later) — the
  // same maker-approver queue as the admin dashboard.
  const submitCount = useCallback(async() => {
    if (!isStaff || !product) return;
    const changes = Object.keys(product.stock?.locations || {}).filter((loc) => {
      const current = Number(product.stock.locations[loc]) || 0;
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
    let done = 0;
    const failures = [];
    for (const loc of changes) {
      const locationId = locIdByName[loc];
      if (!locationId) { failures.push(loc); continue; }
      try {
        await createStockAdjustment({
          product_id: Number(product.product.id),
          location_id: Number(locationId),
          new_qty: Number(counts[loc]),
          reason: reason.trim() || `Physical count from QR scan of ${product.product.name}`,
        });
        done += 1;
      } catch (err) {
        failures.push(loc);
      }
    }
    setSubmitBusy(false);
    if (done > 0) {
      setSubmitMsg(
        `${done} transaction(s) submitted — PENDING APPROVAL. Stock updates after the owner approves.` +
        (failures.length > 0 ? ` Failed: ${failures.join(', ')}.` : ''),
      );
      setReason('');
    } else {
      setSubmitErr('Could not submit. Check the product/locations and try again.');
    }
  }, [isStaff, product, counts, reason, locIdByName]);

  // Guest lock: scanning is a signed-in feature (the Home tile is already
  // hidden for guests, but deep links land here too).
  if (!isLoggedIn) {
    return (
      <View style={styles.center}>
        <Text style={styles.lockGlyph}>▣</Text>
        <Text style={styles.lockTitle}>Log in to scan QR codes</Text>
        <Text style={styles.lockBody}>
          Point the camera at a product's QR tag to open it instantly — a member feature.
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => navigation.navigate('Login')} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Log In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => navigation.navigate('Signup')} activeOpacity={0.85}>
          <Text style={styles.btnGhostText}>Create Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Guard: handle both "denied" and "still loading" permission states before
  // mounting the camera.
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.lockGlyph}>📷</Text>
        <Text style={styles.lockTitle}>Camera access needed</Text>
        <Text style={styles.lockBody}>
          Camera permission is required to scan QR codes. Point it at a product tag once allowed.
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleProduct = async (parsed) => {
    // Audit every scan — an unknown code pointed at the scanner is exactly
    // the kind of event worth reviewing.
    createScanEvent({ payload: parsed.raw.slice(0, 300), kind: 'product', target_id: parsed.id }).catch(() => {});
    lockRef.current = true;
    setBusy(true);
    try {
      const data = await getProductByQr({ code: parsed.code });
      if (isStaff) {
        setProduct(data);
      } else if (data?.product?.id) {
        navigation.navigate('Products', { focusId: data.product.id });
      }
    } catch (err) {
      const status = err && err.status;
      if (status === 400) {
        Alert.alert('Invalid QR code', 'Invalid QR code. Please scan a valid INVENTRAK QR code.');
        setLast({ type: 'unknown', raw: parsed.raw.slice(0, 120) });
      } else if (status === 404) {
        Alert.alert('Not registered', 'QR code is not registered in INVENTRAK.');
        setLast({ type: 'unknown', raw: parsed.raw.slice(0, 120) });
      } else if (status === 409) {
        Alert.alert('Inactive product', 'This product is currently inactive.');
        setLast({ type: 'unknown', raw: parsed.raw.slice(0, 120) });
      } else if (status === 401 || status === 403) {
        Alert.alert('Not authorized', 'You are not authorized to perform this inventory action.');
      } else {
        Alert.alert('Network error', 'Unable to retrieve product information. Please check your connection.');
      }
    } finally {
      setBusy(false);
      setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
    }
  };

  const handleScan = ({ data }) => {
    if (busy || lockRef.current) return;
    // While the staff verify-and-record sheet is open, the camera keeps
    // streaming behind it — ignore further scans until the sheet is cleared
    // ("Scan another") so the form can't be clobbered mid-count.
    if (isStaff && product) return;
    const parsed = parseQr(data);

    if (parsed.kind === 'unknown') {
      // Unrecognized tag — say so instead of doing nothing. Hold the lock
      // briefly so the alert cannot stack while the code stays in frame.
      createScanEvent({ payload: parsed.raw.slice(0, 300), kind: 'unknown', target_id: null }).catch(() => {});
      lockRef.current = true;
      setLast({ type: 'unknown', raw: String(data || '').slice(0, 120) });
      Alert.alert(
        'QR code not recognized',
        'Invalid QR code. Please scan a valid INVENTRAK QR code.',
      );
      setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
      return;
    }

    if (parsed.kind === 'location') {
      createScanEvent({ payload: parsed.raw.slice(0, 300), kind: 'location', target_id: parsed.id, location: parsed.name }).catch(() => {});
      lockRef.current = true;
      setBusy(true);
      // Existence check before navigating: a tag for a location deleted since
      // printing must say so instead of opening an empty screen.
      listLocations()
        .then((locations) => {
          const list = Array.isArray(locations) ? locations : (locations && locations.data) || [];
          if (!list.some((l) => Number(l.id) === Number(parsed.id))) {
            const err = new Error('Location not found');
            err.status = 404;
            throw err;
          }
          // Open the availability view scoped to the scanned storage area.
          navigation.navigate('StockAvailability', { location: parsed.name });
        })
        .catch(() => {
          setLast({ type: 'unknown', raw: `location #${parsed.id} (no longer exists)` });
          Alert.alert(
            'Tag target not found',
            `This tag points to location #${parsed.id}, which no longer exists. Reprint it from the admin.`,
          );
        })
        .finally(() => {
          setBusy(false);
          setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
        });
      return;
    }

    handleProduct(parsed);
  };

  const scannedProduct = product?.product;

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={torchOn}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'codabar', 'pdf417'] }}
        onBarcodeScanned={handleScan}
      />
      <View style={styles.overlay}>
        <Text style={styles.overlayTitle}>Point at a product's QR code</Text>
        <Text style={styles.overlaySub}>
          {isStaff
            ? 'Product tags open the verify & count panel; location tags open that area\u2019s stock. Every scan is logged.'
            : 'Product tags open the product; location tags open that storage area\u2019s stock. Every scan is logged.'}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.torchBtn, torchOn && styles.torchBtnOn]}
        onPress={() => setTorchOn((v) => !v)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
      >
        <Text style={[styles.torchText, torchOn && styles.torchTextOn]}>{torchOn ? '🔆 Torch on' : '🔅 Torch'}</Text>
      </TouchableOpacity>
      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.busyText}>Product identified — retrieving details…</Text>
        </View>
      )}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
        {last && last.type === 'unknown' ? (
          <Text style={styles.unknownNote} numberOfLines={2}>
            Last scan: “{last.raw}” — not an INVENTRAK tag
          </Text>
        ) : null}
      </View>

      {/* Staff verify-and-record panel: appears over the camera after a
          product tag resolves. Confirm the product, enter the physically
          counted quantity per location, submit → PENDING APPROVAL. */}
      {isStaff && scannedProduct ? (
        <ScrollView style={styles.countSheet} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.countHeader}>
            <Text style={styles.countTitle}>Product identified</Text>
            <TouchableOpacity onPress={() => setProduct(null)} accessibilityLabel="Scan another product">
              <Text style={styles.countRescan}>Scan another</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.countName}>{scannedProduct.name}</Text>
          <Text style={styles.countMeta}>
            {product.qr?.sku}
            {scannedProduct.category ? ` · ${scannedProduct.category}` : ''}
            {scannedProduct.unit ? ` · ${scannedProduct.unit}` : ''}
          </Text>
          <Text style={styles.countStockLine}>
            Total on hand: {product.stock?.total ?? 0} ({product.stock?.status === 'out' ? 'out of stock' : product.stock?.status === 'low' ? 'low stock' : 'in stock'})
          </Text>
          {product.lots && product.lots.length > 0 ? (
            <Text style={styles.countLots} numberOfLines={3}>
              Open lots: {product.lots.map((l) => `${l.location_name || `#${l.location_id}`}${l.expiry_date ? ` (best before ${l.expiry_date})` : ''} ×${l.qty}`).join(', ')}
            </Text>
          ) : null}
          <Text style={[styles.countSub, styles.countInstructions]}>
            Verify the product above matches the item you counted, enter the actual quantity per
            storage area, and submit. Each change becomes a PENDING adjustment the owner approves
            before it applies to official stock.
          </Text>
          {Object.keys(product.stock?.locations || {}).map((loc) => (
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
              <Text style={styles.countCurrent}>cur: {product.stock.locations[loc] ?? 0}</Text>
            </View>
          ))}
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            placeholderTextColor={colors.textSecondary}
          />
          <TouchableOpacity
            style={styles.countBtn}
            onPress={submitCount}
            disabled={submitBusy}
            activeOpacity={0.85}
          >
            <Text style={styles.countBtnText}>
              {submitBusy ? 'Submitting…' : 'Submit for approval'}
            </Text>
          </TouchableOpacity>
          {submitMsg ? <Text style={styles.countOk}>{submitMsg}</Text> : null}
          {submitErr ? <Text style={styles.countErr}>{submitErr}</Text> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    btn: { alignItems: 'center', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 13 },
    btnGhost: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: 'rgba(0,0,0,0.1)', borderWidth: 1.5 },
    btnGhostText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    btnPrimary: { backgroundColor: colors.brandPrimary, marginTop: 4 },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    busyOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 12,
      bottom: 110,
      left: 24,
      padding: 14,
      position: 'absolute',
      right: 24,
    },
    busyText: { color: '#fff', fontSize: 13, marginTop: 8 },
    camera: { flex: 1 },
    center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: 28 },
    container: { backgroundColor: '#000', flex: 1 },
    footer: { alignItems: 'center', bottom: 28, left: 0, paddingHorizontal: 24, position: 'absolute', right: 0 },
    lockBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20, marginTop: 8, textAlign: 'center' },
    lockGlyph: { fontSize: 44, marginBottom: 12 },
    lockTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
    overlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 12,
      left: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      position: 'absolute',
      right: 16,
      top: 60,
    },
    overlaySub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 17, marginTop: 4, textAlign: 'center' },
    overlayTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    torchBtn: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderColor: 'rgba(255,255,255,0.35)',
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 9,
      position: 'absolute',
      right: 16,
      top: 150,
    },
    torchBtnOn: { backgroundColor: 'rgba(255,214,10,0.9)', borderColor: 'rgba(255,214,10,1)' },
    torchText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    torchTextOn: { color: '#1a1a1a' },
    unknownNote: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 10, textAlign: 'center' },
    // ---- Staff verify-and-record sheet ----
    countSheet: {
      backgroundColor: colors.background,
      borderColor: 'rgba(0,0,0,0.15)',
      borderRadius: 16,
      borderWidth: 1,
      bottom: 0,
      left: 0,
      maxHeight: '62%',
      padding: 16,
      position: 'absolute',
      right: 0,
    },
    countHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    countTitle: { color: colors.brandPrimary, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
    countRescan: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
    countName: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 6 },
    countMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    countStockLine: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginTop: 6 },
    countLots: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 4 },
    countInstructions: { marginTop: 8 },
    countSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    countRow: { alignItems: 'center', flexDirection: 'row', marginTop: 8 },
    countLoc: { color: colors.textPrimary, flex: 1, fontSize: 13, fontWeight: '600', paddingRight: 8 },
    countInput: {
      backgroundColor: colors.surface,
      borderColor: 'rgba(0,0,0,0.1)',
      borderRadius: 8,
      borderWidth: 1,
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
      paddingHorizontal: 10,
      paddingVertical: 8,
      textAlign: 'center',
      width: 74,
    },
    countCurrent: { color: colors.textSecondary, fontSize: 11, marginLeft: 8, width: 52 },
    reasonInput: {
      backgroundColor: colors.surface,
      borderColor: 'rgba(0,0,0,0.1)',
      borderRadius: 8,
      borderWidth: 1,
      color: colors.textPrimary,
      fontSize: 14,
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    countBtn: {
      alignItems: 'center',
      backgroundColor: colors.brandSecondary,
      borderRadius: 10,
      marginTop: 12,
      paddingVertical: 12,
    },
    countBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    countOk: { color: colors.success, fontSize: 12, lineHeight: 17, marginTop: 8 },
    countErr: { color: colors.error, fontSize: 12, lineHeight: 17, marginTop: 8 },
  });

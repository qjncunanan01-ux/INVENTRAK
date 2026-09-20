import { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  createStockAdjustment,
  imageUrl,
  listLocations,
  ocrStockCheck,
  scanProductPhoto,
  STAFF_TOOLS_ROLES,
  useSessionRole,
  useSessionUsername,
} from '../api';
import { useThemeColors } from '../theme-context';

// OCR module (reviewer requirement): snap or pick a product photo, the
// backend runs tesseract OCR and fuzzy-matches the catalog.
//
// Member-only (matches the Home tile, which is hidden for guests): scanning
// is a signed-in feature. Guests landing here see a lock screen instead.
//
// Results open the PRODUCT detail page (not the order form): a strong match
// (score >= 0.75 with a clear gap to the runner-up) auto-opens that product,
// and ambiguous results show a match list whose cards open the product for
// review — the buyer decides to order from there.

// Strong-match rule: high absolute score AND a healthy gap so the #1 pick
// isn't just slightly better than a near-tie.
const STRONG_SCORE = 0.75;
const STRONG_GAP = 0.2;

export default function OcrScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isLoggedIn = !!useSessionUsername(null);
  // Staff/admin accounts get the verify-and-count flow after a scan: the
  // physical count is submitted as a PENDING adjustment the owner approves.
  // STAFF_TOOLS_ROLES = staff + admin + super_admin + owner.
  const role = useSessionRole();
  const isStaff = STAFF_TOOLS_ROLES.includes(role);

  // NOTE: all hooks must stay above the login gate (Rules of Hooks) — the
  // gate below is a render decision, not a hook-count decision.
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(null);
  const [text, setText] = useState('');
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');
  // Staff count form: corrected physical quantity per location + a reason,
  // submitted as one pending adjustment per changed location.
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  // Location name -> id map (the adjustment endpoint needs location_id).
  const [locIdByName, setLocIdByName] = useState({});

  // Load the location list so staff corrections address the right storage
  // area by id (same map the admin Scan & Stock page builds).
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

  // Reset the count form whenever a new scan lands.
  const topMatch = matches[0] || null;
  useEffect(() => {
    if (!isStaff || !topMatch) return;
    const next = {};
    Object.keys(topMatch.stock?.locations || {}).forEach((k) => {
      next[k] = topMatch.stock.locations[k];
    });
    setCounts(next);
    setReason('');
    setSubmitMsg('');
    setSubmitErr('');
  }, [isStaff, topMatch && topMatch.id]);

  // Staff submit: for every location whose counted qty differs from the
  // current stock, create a pending adjustment (owner approves later).
  const submitCount = useCallback(async() => {
    if (!isStaff || !topMatch) return;
    const changes = Object.keys(topMatch.stock?.locations || {}).filter((loc) => {
      const current = Number(topMatch.stock.locations[loc]) || 0;
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
          product_id: Number(topMatch.id),
          location_id: Number(locationId),
          new_qty: Number(counts[loc]),
          reason: reason.trim() || `Physical count from scan of ${topMatch.name}`,
        });
        done += 1;
      } catch (err) {
        failures.push(loc);
      }
    }
    setSubmitBusy(false);
    if (done > 0) {
      setSubmitMsg(
        `${done} correction(s) submitted — the owner will approve them before stock updates.`
        + (failures.length > 0 ? ` Failed: ${failures.join(', ')}.` : ''),
      );
      setReason('');
    } else {
      setSubmitErr('Could not submit corrections. Check the product/locations and try again.');
    }
  }, [isStaff, topMatch, counts, reason, locIdByName]);

  // Locked state for guests: the feature exists but needs an account.
  if (!isLoggedIn) {
    return (
      <View style={styles.lockWrap}>
        <Text style={styles.lockGlyph}>📷</Text>
        <Text style={styles.lockTitle}>Log in to scan products</Text>
        <Text style={styles.lockBody}>
          Product scanning lets you snap a label and instantly match it to the
          catalog — a member feature.
        </Text>
        <TouchableOpacity
          style={[styles.lockBtn, styles.lockBtnPrimary]}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.lockBtnPrimaryText}>Log In</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.lockBtn, styles.lockBtnGhost]}
          onPress={() => navigation.navigate('Signup')}
          activeOpacity={0.85}
        >
          <Text style={styles.lockBtnGhostText}>Create Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Open a matched product's detail page (the catalog's Products screen is
  // the stack root beneath this one, so navigate() pops back to it with the
  // focusId deep-link and ProductScreen shows the PDP).
  const openProduct = (match) => {
    navigation.navigate('Products', { focusId: match.id });
  };

  const requestPermission = async() => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    return perm.granted;
  };

  const pickImage = async(useCamera) => {
    setError('');
    if (useCamera) {
      const ok = await requestPermission();
      if (!ok) {
        Alert.alert('Permission needed', 'Camera access is required to scan a product label.');
        return;
      }
    }
    try {
      // NOTE: `allowsEditing` is deliberately OFF — the built-in crop/rotate
      // editor renders a black preview on several Android devices (a known
      // expo-image-picker issue), and the OCR pipeline doesn't need a crop
      // anyway: the backend reads the whole label.
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({
          base64: true,
          quality: 0.8,
        })
        : await ImagePicker.launchImageLibraryAsync({
          base64: true,
          quality: 0.8,
        });

      if (result.canceled || !result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      if (!asset.uri) {
        Alert.alert('No image', 'Could not read the selected image.');
        return;
      }
      setImage(asset.uri);
      setMatches([]);
      setText('');

      // Preprocess before upload — same recipe as the admin scanner: normalize
      // to ~1600px (upscales small labels, caps huge photos), grayscale +
      // contrast boost. Glossy bottle photos defeat raw tesseract; this makes
      // real camera scans read far more reliably. Falls back to the original
      // on any error so a scan is never blocked.
      let payload;
      try {
        const processed = await ImageManipulator.manipulateAsync(
          asset.uri,
          [
            { resize: { width: 1600 } },
            { grayscale: {} },
            { contrast: 1.6 },
          ],
          { base64: true, compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
        );
        payload = processed.base64 || asset.base64;
      } catch (preErr) {
        payload = asset.base64;
      }
      if (!payload) {
        Alert.alert('No image', 'Could not read the selected image.');
        return;
      }
      // Pass the original file name along: catalog-image uploads (the SYLVER
      // product photos from the gallery) resolve to the exact product by name
      // on the server — no OCR needed, and those ~300px thumbnails contain
      // no readable text anyway. Camera captures have no file name, so OCR
      // runs on the full-res frame as before.
      await runOcr(payload, asset.fileName);
    } catch (err) {
      setError('Could not open the camera / photo library.');
    }
  };

  const runOcr = async(base64, filename) => {
    setBusy(true);
    setError('');
    try {
      // Staff/admin scans use the stock-aware endpoint so each match carries
      // live per-location quantities for the verify-and-count form; customer
      // scans use the public OCR (no stock attached).
      const data = isStaff
        ? await ocrStockCheck(filename ? { image: base64, filename } : { image: base64 })
        : await scanProductPhoto(filename ? { image: base64, filename } : { image: base64 });
      const list = Array.isArray(data.matches) ? data.matches : [];
      setText(data.text || '');
      setMatches(list);
      if (list.length === 0) {
        if (!data.text || !data.text.trim()) {
          setError('No text recognized. Try a clearer, well-lit photo of the label.');
        } else {
          // Text WAS read, but nothing in it names a SYLVER catalog product.
          // Only products in the SYLVER supply catalog are scannable, so a
          // foreign/unknown label must say so instead of staying silent.
          setError(
            'No SYLVER product detected — this label doesn\u2019t match anything in the catalog. ' +
            'Only products in the SYLVER supply catalog can be scanned.',
          );
        }
      }
      // Confident single pick -> jump straight to the product detail — but
      // NOT for staff, who stay on the scan screen to verify the match and
      // record the physical count (the whole point of their flow).
      const top = list[0];
      if (top && !isStaff) {
        const second = list[1];
        if (top.score >= STRONG_SCORE && (!second || top.score - second.score >= STRONG_GAP)) {
          openProduct(top);
        }
      }
    } catch (err) {
      setError(err.message || 'OCR failed. Is the backend running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>Scan a product</Text>
      <Text style={styles.subtitle}>
        Take a photo of a product label or upload one — we'll recognize it and match it to
        the catalog, then open the product so you can review and order it.
      </Text>

      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => pickImage(true)} disabled={busy}>
          <Text style={styles.btnPrimaryText}>📷 Take photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => pickImage(false)} disabled={busy}>
          <Text style={styles.btnGhostText}>🖼 Upload photo</Text>
        </TouchableOpacity>
      </View>
      {/* QR/barcode tag scanner (location tags + product tags) — a second
          camera flow that reads the system's printed tags instead of OCR-ing
          a label. */}
      <TouchableOpacity
        style={styles.qrBtn}
        onPress={() => navigation.navigate('QrScan')}
        activeOpacity={0.85}
      >
        <Text style={styles.qrBtnText}>▦ Scan a QR / barcode tag</Text>
      </TouchableOpacity>

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.busyText}>Reading label...</Text>
        </View>
      )}

      {image ? <Image source={{ uri: image }} style={styles.preview} resizeMode="cover" /> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {text && text.trim() ? (
        <View style={styles.textCard}>
          <Text style={styles.textCardTitle}>Recognized (used for matching)</Text>
          <Text style={styles.recognized}>{text.trim().slice(0, 400)}</Text>
        </View>
      ) : null}

      {matches.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>Matched products</Text>
          {matches.map((m, idx) => (
            <TouchableOpacity
              key={m.id ?? m.name ?? idx}
              style={styles.matchCard}
              onPress={() => openProduct(m)}
              activeOpacity={0.7}
            >
              {m.image ? (
                <Image source={{ uri: imageUrl(m.image) }} style={styles.matchThumb} resizeMode="cover" />
              ) : null}
              <View style={styles.matchInfo}>
                <Text style={styles.matchName}>{m.name}</Text>
                <Text style={styles.matchMeta}>P{m.price} · {(m.score * 100).toFixed(0)}% match</Text>
              </View>
              <Text style={styles.matchCta}>View ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Staff flow (reviewer requirement: verify & matching interface on
          the phone too): the scanned text + suggested match are shown side
          by side, and staff confirm the physical count per location BEFORE
          anything is saved — corrections become pending adjustments the
          owner approves. Customers never see this section. */}
      {isStaff && topMatch && topMatch.stock ? (
        <View style={styles.countCard}>
          <Text style={styles.countTitle}>Verify & record physical count</Text>
          <Text style={styles.countSub}>
            Confirm the scan matches <Text style={styles.countStrong}>{topMatch.name}</Text>,
            enter the actual counted quantity per location, and submit. Each
            change becomes a pending adjustment the owner approves before it
            applies to stock.
          </Text>
          <View style={styles.countRows}>
            {Object.keys(topMatch.stock.locations || {}).map((loc) => (
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
                <Text style={styles.countCurrent}>cur: {topMatch.stock.locations[loc] ?? 0}</Text>
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
          <TouchableOpacity
            style={styles.countBtn}
            onPress={submitCount}
            disabled={submitBusy}
            activeOpacity={0.85}
          >
            <Text style={styles.countBtnText}>
              {submitBusy ? 'Submitting…' : 'Submit corrections for approval'}
            </Text>
          </TouchableOpacity>
          {submitMsg ? <Text style={styles.countOk}>{submitMsg}</Text> : null}
          {submitErr ? <Text style={styles.countErr}>{submitErr}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.background, flex: 1, padding: 20 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  btn: { alignItems: 'center', borderRadius: 12, flex: 1, paddingVertical: 14 },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnGhost: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  btnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  qrBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.brandSecondary,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 16,
    paddingVertical: 13,
  },
  qrBtnText: { color: colors.brandSecondary, fontSize: 14, fontWeight: '700' },
  busy: { alignItems: 'center', paddingVertical: 24 },
  busyText: { color: colors.textSecondary, fontSize: 14, marginTop: 10 },
  preview: { backgroundColor: colors.surface, borderRadius: 12, height: 200, marginBottom: 12, width: '100%' },
  error: { color: colors.error, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  textCard: { backgroundColor: colors.surface, borderRadius: 12, marginBottom: 16, padding: 14 },
  textCardTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 6 },
  recognized: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 10 },
  matchCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 12,
  },
  matchThumb: { backgroundColor: colors.background, borderRadius: 8, height: 48, marginRight: 12, width: 48 },
  matchInfo: { flex: 1 },
  matchName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  matchMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  matchCta: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
  // ---- Staff verify-and-count panel ----
  countCard: {
    backgroundColor: colors.surface,
    borderColor: colors.brandSecondary,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 8,
    padding: 14,
  },
  countTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  countSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  countStrong: { color: colors.textPrimary, fontWeight: '800' },
  countRows: { marginTop: 10 },
  countRow: { alignItems: 'center', flexDirection: 'row', marginBottom: 8 },
  countLoc: { color: colors.textPrimary, flex: 1, fontSize: 13, fontWeight: '600', paddingRight: 8 },
  countInput: {
    backgroundColor: colors.background,
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
    backgroundColor: colors.background,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  countBtn: {
    alignItems: 'center',
    backgroundColor: colors.brandSecondary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  countBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  countOk: { color: colors.success, fontSize: 12, lineHeight: 17, marginTop: 8 },
  countErr: { color: colors.error, fontSize: 12, lineHeight: 17, marginTop: 8 },
  lockWrap: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 },
  lockGlyph: { fontSize: 44, marginBottom: 12 },
  lockTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  lockBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  lockBtn: { alignItems: 'center', borderRadius: 12, marginBottom: 10, maxWidth: 320, paddingVertical: 14, width: '100%' },
  lockBtnPrimary: { backgroundColor: colors.brandPrimary },
  lockBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  lockBtnGhost: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  lockBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

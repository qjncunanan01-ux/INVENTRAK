import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { createScanEvent, getInventory } from '../api';
import CountCard from '../components/CountCard';
import { useThemeColors } from '../theme-context';

// MODULE 1: QR / BARCODE TAG SCANNER. Reads the system's printed tags with
// the live camera — or, when the camera can't (damaged tag, glare, broken
// hardware), accepts the code typed in by hand ("Enter Code Manually").
//   - Location tag (INVENTRAK:LOC:<id>:<name>) → that storage area's stock,
//     shown inline on this screen.
//   - Product tag (INVENTRAK:PROD:<id> or a bare barcode number) → opens the
//     shared CountCard for that product.
// Each camera workflow gets its own screen so staff train on one thing at
// a time; product identification is QR-only now.

// Same payload grammar as the admin's printed tags (and the customer app's
// scanner, where these components were proven out).
function parseQr(data) {
  const raw = String(data || '').trim();
  // Camera-friendly printed tags carry the payload wrapped in a URL to the
  // public tag page (so native camera apps open real content too). Unwrap to
  // the plain payload — every rule below operates on the plain form.
  const urlMatch = raw.match(/^https:\/\/[^\s/]+\/t\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/);
  if (urlMatch) return parseQr(`INVENTRAK:PROD:${urlMatch[1]}`);
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

export default function QrScanScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // last unknown payload, for the note

  // Manual entry (the mockup's "Enter Code Manually"): a typed tag code shares
  // the exact parse + audit pipeline of a camera scan.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // The focused product for the CountCard + the location view.
  const [focus, setFocus] = useState(null); // { id, name, stock }
  const [locView, setLocView] = useState(null); // { name, rows: [{id,name,total}] }

  // Synchronous scan lock: onBarcodeScanned can fire several times inside one
  // frame, before React re-renders with busy=true. Re-armed on focus.
  const lockRef = useRef(false);
  useFocusEffect(
    useMemo(() => () => {
      lockRef.current = false;
      setBusy(false);
    }, [])
  );

  // Product tag → live per-location stock from /api/inventory → CountCard.
  const focusProductById = useCallback(async (id) => {
    try {
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      const item = (parsed.items || []).find((i) => Number(i.product?.id) === Number(id));
      if (!item) {
        Alert.alert('Not in stock view', 'That product has no stock record yet — create one from the admin Inventory page first.');
        return;
      }
      setFocus({ id: item.product.id, name: item.product.name, stock: { locations: item.locations || {} } });
      setLocView(null);
    } catch {
      Alert.alert('Offline', 'Could not load stock for that tag. Try again.');
    }
  }, []);

  // Location tag → that storage area's stock, inline (no navigation).
  const focusLocationByName = useCallback(async (name) => {
    try {
      const r = await getInventory();
      const parsed = r && r.data ? r.data : r;
      const rows = (parsed.items || [])
        .filter((i) => (i.locations || {})[name] !== undefined)
        .map((i) => ({ id: i.product?.id, name: i.product?.name || '?', total: i.locations[name] || 0 }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      setLocView({ name, rows });
      setFocus(null);
    } catch {
      Alert.alert('Offline', 'Could not load that location. Try again.');
    }
  }, []);

  // Shared resolver: parse → audit → dispatch. Both the camera pipeline and
  // manual entry land here, so a typed code is audited and behaves exactly
  // like a scan (location tags inline, product tags open the CountCard).
  const resolveCode = useCallback(async (rawInput) => {
    const raw = String(rawInput || '').trim();
    if (!raw) return;
    const parsed = parseQr(raw);
    // Audit every resolve (recognized or not) — fire-and-forget, never blocks.
    createScanEvent({
      payload: parsed.raw,
      kind: parsed.kind,
      target_id: parsed.kind === 'unknown' ? null : parsed.id,
      location: parsed.kind === 'location' ? parsed.name : null,
    }).catch(() => {});

    if (parsed.kind === 'location') {
      setBusy(true);
      try { await focusLocationByName(parsed.name); } finally { setBusy(false); }
      return;
    }
    if (parsed.kind === 'product') {
      setBusy(true);
      try { await focusProductById(parsed.id); } finally { setBusy(false); }
      return;
    }
    // Unrecognized tag — say so instead of staying silent.
    setLast({ raw: raw.slice(0, 120) });
    Alert.alert(
      'Tag not recognized',
      'This QR code is not an INVENTRAK location or product tag. Only tags generated by the system can be resolved.'
    );
  }, [focusLocationByName, focusProductById]);

  const handleScan = ({ data }) => {
    if (busy || lockRef.current) return;
    if (!String(data || '').trim()) return;
    lockRef.current = true;
    resolveCode(data).finally(() => {
      setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
    });
  };

  // Manual entry is deliberate, so no camera lock — close the sheet, resolve.
  const submitManual = useCallback(() => {
    const raw = manualCode.trim();
    if (!raw) return;
    setManualOpen(false);
    setManualCode('');
    resolveCode(raw);
  }, [manualCode, resolveCode]);

  const manualSheet = (
    <ManualEntrySheet
      visible={manualOpen}
      code={manualCode}
      onChangeCode={setManualCode}
      onClose={() => setManualOpen(false)}
      onSubmit={submitManual}
      colors={colors}
      styles={styles}
    />
  );

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
          This module uses the camera to read the QR/barcode tag you point it at.
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Allow camera</Text>
        </TouchableOpacity>
        <Text style={styles.lockOr}>or</Text>
        <TouchableOpacity style={[styles.btn, styles.manualDenied]} onPress={() => setManualOpen(true)} activeOpacity={0.85}>
          <Text style={styles.manualDeniedText}>⌨  Enter Code Manually</Text>
        </TouchableOpacity>
        {manualSheet}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.moduleTitle}>QR / Barcode Scanner</Text>
      <Text style={styles.moduleSub}>
        Point at an INVENTRAK tag: location tags show that storage area's stock; product tags
        open its count card. Every scan is logged to the audit trail. Camera not cooperating?
        Enter the code printed under the tag manually.
      </Text>

      <View style={styles.cameraCard}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'codabar', 'pdf417'] }}
          onBarcodeScanned={handleScan}
        />
        {busy ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.busyText}>Loading…</Text>
          </View>
        ) : null}
      </View>

      {/* Manual entry (mockup's "Enter Code Manually"): type the code printed
          under a tag when the camera can't read it — damaged tag, glare, or a
          broken camera. Resolves through the exact same pipeline as a scan. */}
      <TouchableOpacity style={styles.manualPill} onPress={() => setManualOpen(true)} activeOpacity={0.85}>
        <Text style={styles.manualPillText}>⌨  Enter Code Manually</Text>
      </TouchableOpacity>

      {/* Location-tag result: that storage area's stock, inline */}
      {locView ? (
        <View style={styles.locCard}>
          <View style={styles.locHead}>
            <Text style={styles.locTitle}>Stock at {locView.name}</Text>
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

      {/* Product tag → the shared count card */}
      <CountCard focus={focus} onClear={() => setFocus(null)} />

      {last ? (
        <Text style={styles.unknownNote}>Last scan: “{last.raw}” — not an INVENTRAK tag</Text>
      ) : null}

      {manualSheet}
    </ScrollView>
  );
}

// The manual-entry sheet behind "Enter Code Manually": types the code printed
// under a tag instead of pointing the camera at it. Same parser, same audit
// trail, same result as a scan — a fallback for the camera, not a separate
// workflow.
function ManualEntrySheet({ visible, code, onChangeCode, onClose, onSubmit, colors, styles }) {
  const inputRef = useRef(null);
  // Autofocus once the slide-in animation has placed the sheet.
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 250);
    return () => clearTimeout(t);
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetBackdrop}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheetCard}>
          <Text style={styles.sheetTitle}>Enter Code Manually</Text>
          <Text style={styles.sheetSub}>
            Type the code printed under a tag — the tag URL (e.g. https://…/t/12),
            INVENTRAK:PROD:12, or a location tag. It resolves exactly like a scan.
          </Text>
          <TextInput
            ref={inputRef}
            style={styles.sheetInput}
            value={code}
            onChangeText={onChangeCode}
            placeholder="INVENTRAK:PROD:12"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
          <View style={styles.sheetActions}>
            <TouchableOpacity style={[styles.btn, styles.sheetCancel]} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, styles.sheetGo]} onPress={onSubmit} activeOpacity={0.85}>
              <Text style={styles.btnPrimaryText}>Resolve code</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.background },
    moduleTitle: { fontSize: 21, fontWeight: '800', color: colors.textPrimary },
    moduleSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginTop: 3, marginBottom: 12 },
    cameraCard: { borderRadius: 14, overflow: 'hidden', marginBottom: 14 },
    camera: { height: 320 },
    busyOverlay: {
      position: 'absolute',
      bottom: 10,
      left: 0,
      right: 0,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    busyText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    locCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1.5,
      borderColor: colors.brandSecondary,
    },
    locHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    locTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
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
    unknownNote: { color: colors.textSecondary, fontSize: 12, marginTop: 10, textAlign: 'center' },
    btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, alignItems: 'center', marginTop: 4 },
    btnPrimary: { backgroundColor: colors.brandPrimary },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    lockGlyph: { fontSize: 44, marginBottom: 12 },
    lockTitle: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    lockBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8, marginBottom: 20 },
    lockOr: { fontSize: 12, color: colors.textSecondary, marginTop: 14, marginBottom: 6 },
    manualDenied: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brandSecondary, alignSelf: 'stretch' },
    manualDeniedText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
    manualPill: {
      alignSelf: 'center',
      width: '86%',
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingVertical: 13,
      alignItems: 'center',
      marginBottom: 14,
      borderWidth: 1.5,
      borderColor: colors.brandSecondary,
    },
    manualPillText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheetCard: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 18,
      paddingBottom: 30,
    },
    sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    sheetSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginTop: 4, marginBottom: 12 },
    sheetInput: {
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '700',
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    sheetActions: { flexDirection: 'row', gap: 10 },
    sheetCancel: { flex: 1, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
    sheetCancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '800' },
    sheetGo: { flex: 1.4, marginTop: 0 },
  });

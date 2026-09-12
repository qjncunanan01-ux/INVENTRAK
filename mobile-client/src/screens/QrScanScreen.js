import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { apiPost } from '../api';
import { useThemeColors } from '../theme-context';

// Minimum gap between two accepted scans. onBarcodeScanned fires on every
// camera frame while a code is in view, so without this a single tag can fire
// a dozen times (double navigation, a stack of "not recognized" alerts).
const RESCAN_COOLDOWN_MS = 1500;

// QR & barcode scanner (reviewer requirement: location tagging + camera
// scanner for quick lookups).
//
// Payloads this scanner understands:
//   - INVENTRAK:LOC:<id>:<name>  — a storage-area tag printed from the admin
//     Locations page; opens that location's stock availability view.
//   - INVENTRAK:PROD:<id>        — a product tag; opens that product's detail
//     page in the catalog.
//   - a bare number              — treated as a product id (barcode fallback).
// Anything else is reported as unrecognized instead of silently ignored, so
// staff know the tag wasn't one of the system's.

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

// Record the scan in the server audit trail (who scanned what, when). Fire and
// forget: logging must never block the scan from doing its job, and an offline
// phone should still navigate.
function logScan(parsed) {
  apiPost('/api/scan-events', {
    payload: parsed.raw,
    kind: parsed.kind,
    target_id: parsed.kind === 'unknown' ? null : parsed.id,
    location: parsed.kind === 'location' ? parsed.name : null,
  }).catch(() => {});
}

export default function QrScanScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // last decoded payload (for the "not recognized" case)

  // Synchronous lock: onBarcodeScanned can fire several times inside one frame,
  // before React has re-rendered with busy=true. The ref closes that window so
  // a tag can never navigate twice, and the cooldown stops the camera from
  // re-triggering on the same code that is still in view.
  const lockRef = useRef(false);

  // Re-arm the scanner whenever the screen regains focus (after navigating
  // to a product/location and coming back, a new tag can be scanned).
  useFocusEffect(
    useMemo(() => () => {
      lockRef.current = false;
      setBusy(false);
    }, [])
  );

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
          Scanning QR/barcode tags uses the camera to read the tag you point it at.
        </Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={styles.btnPrimaryText}>Allow camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleScan = ({ data }) => {
    if (busy || lockRef.current) return;
    const parsed = parseQr(data);

    // Audit every scan, recognized or not — an unrecognized tag being pointed
    // at the scanner is exactly the kind of thing worth being able to review.
    logScan(parsed);

    if (parsed.kind === 'location') {
      lockRef.current = true;
      setBusy(true);
      // Open the availability view scoped to the scanned storage area.
      navigation.navigate('StockAvailability', { location: parsed.name });
      return;
    }
    if (parsed.kind === 'product') {
      lockRef.current = true;
      setBusy(true);
      // Deep-link the catalog to that product's detail page.
      navigation.navigate('Products', { focusId: parsed.id });
      return;
    }

    // Unrecognized tag — say so instead of doing nothing (a foreign QR code
    // must not look like a silent miss). Hold the lock briefly so the alert
    // cannot stack while the same code stays in frame, then re-arm so the
    // operator can immediately try a different tag.
    lockRef.current = true;
    setLast({ type: 'unknown', raw: String(data || '').slice(0, 120) });
    Alert.alert(
      'Tag not recognized',
      'This QR code is not an INVENTRAK location or product tag. Only tags generated by the system can be scanned.'
    );
    setTimeout(() => { lockRef.current = false; }, RESCAN_COOLDOWN_MS);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'codabar', 'pdf417'] }}
        onBarcodeScanned={handleScan}
      />
      <View style={styles.overlay}>
        <Text style={styles.overlayTitle}>Point at a QR or barcode tag</Text>
        <Text style={styles.overlaySub}>
          Location tags open that storage area's stock; product tags open the product. Every scan is logged.
        </Text>
      </View>
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
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    camera: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.background },
    lockGlyph: { fontSize: 44, marginBottom: 12 },
    lockTitle: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    lockBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8, marginBottom: 20 },
    btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, alignItems: 'center' },
    btnPrimary: { backgroundColor: colors.brandPrimary, marginTop: 4 },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    btnGhost: { backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)' },
    btnGhostText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    overlay: {
      position: 'absolute',
      left: 16,
      right: 16,
      top: 60,
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    overlayTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    overlaySub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 17 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center', paddingHorizontal: 24 },
    unknownNote: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 10, textAlign: 'center' },
  });
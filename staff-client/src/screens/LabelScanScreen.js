import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { createScanEvent, imageUrl, ocrStockCheck } from '../api';
import CountCard from '../components/CountCard';
import { useThemeColors } from '../theme-context';

// MODULE 2: LABEL OCR SCAN. One job: photograph a product label, let the
// backend match it to the catalog, and hand the match to the shared
// CountCard. The live QR camera deliberately lives in its own module
// (QrScanScreen) — each camera workflow trains separately.

// Strong auto-pick rule for OCR matches (same numbers as the admin scanner):
// high absolute score AND a healthy gap to the runner-up.
const STRONG_SCORE = 0.75;
const STRONG_GAP = 0.2;

export default function LabelScanScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(null); // { id, name, stock }

  const applyFocus = (m) => {
    setFocus({ id: Number(m.id), name: m.name, stock: m.stock || { locations: {} } });
  };

  const pickImage = async (useCamera) => {
    setError('');
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
      setMatches([]);
      setOcrText('');
      setFocus(null);

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
        const data = await ocrStockCheck(
          asset.fileName ? { image: payload, filename: asset.fileName } : { image: payload }
        );
        const list = Array.isArray(data.matches) ? data.matches : [];
        setOcrText(data.text || '');
        if (list.length === 0) {
          setError(
            !data.text || !data.text.trim()
              ? 'No text recognized. Try a clearer, well-lit photo of the label.'
              : 'No SYLVER product detected — this label doesn\u2019t match anything in the catalog.'
          );
          return;
        }
        // Strong single match → straight into the count form; ambiguous →
        // pick from the match list below.
        const top = list[0];
        const second = list[1];
        if (top.score >= STRONG_SCORE && (!second || top.score - second.score >= STRONG_GAP)) {
          applyFocus(top);
        }
      } catch (err) {
        setError(err.message || 'OCR failed. Is the backend reachable?');
      } finally {
        setBusy(false);
      }
    } catch {
      setError('Could not open the camera / photo library.');
    }
  };

  // Note: the OCR endpoint (/api/ocr/stock) already logs staff scans
  // server-side; a scan-event here would double-count, so only tag scans
  // from the QR module record one.
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.moduleTitle}>Label Scan (OCR)</Text>
      <Text style={styles.moduleSub}>
        Take a photo of a product label — it is matched against the catalog, then you verify the
        match and record the physical count.
      </Text>

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
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {ocrText && ocrText.trim() ? (
        <View style={styles.textCard}>
          <Text style={styles.textCardTitle}>Recognized (used for matching)</Text>
          <Text style={styles.recognized}>{ocrText.trim().slice(0, 300)}</Text>
        </View>
      ) : null}

      {matches.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>Matches — tap to count</Text>
          {matches.map((m, idx) => (
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

      <CountCard focus={focus} onClear={() => setFocus(null)} />
    </ScrollView>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: colors.background },
    moduleTitle: { fontSize: 21, fontWeight: '800', color: colors.textPrimary },
    moduleSub: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginTop: 3, marginBottom: 12 },
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
    matchCta: { color: colors.brandPrimary, fontWeight: '800', fontSize: 14 },
  });

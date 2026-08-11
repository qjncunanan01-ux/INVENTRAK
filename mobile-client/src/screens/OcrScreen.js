import { useMemo, useState } from 'react';
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
import { imageUrl, scanProductPhoto, useSessionUsername } from '../api';
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

  // NOTE: all hooks must stay above the login gate (Rules of Hooks) — the
  // gate below is a render decision, not a hook-count decision.
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(null);
  const [text, setText] = useState('');
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');

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

  const requestPermission = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    return perm.granted;
  };

  const pickImage = async (useCamera) => {
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
          { base64: true, compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        payload = processed.base64 || asset.base64;
      } catch (preErr) {
        payload = asset.base64;
      }
      if (!payload) {
        Alert.alert('No image', 'Could not read the selected image.');
        return;
      }
      await runOcr(payload);
    } catch (err) {
      setError('Could not open the camera / photo library.');
    }
  };

  const runOcr = async (base64) => {
    setBusy(true);
    setError('');
    try {
      const data = await scanProductPhoto({ image: base64 });
      const list = Array.isArray(data.matches) ? data.matches : [];
      setText(data.text || '');
      setMatches(list);
      if ((!data.text || !data.text.trim()) && list.length === 0) {
        setError('No text recognized. Try a clearer, well-lit photo of the label.');
      }
      // Confident single pick -> jump straight to the product detail.
      const top = list[0];
      if (top) {
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
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: 16 },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnGhost: { borderWidth: 1.5, borderColor: colors.brandPrimary },
  btnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  busy: { alignItems: 'center', paddingVertical: 24 },
  busyText: { marginTop: 10, color: colors.textSecondary, fontSize: 14 },
  preview: { width: '100%', height: 200, borderRadius: 12, marginBottom: 12, backgroundColor: colors.surface },
  error: { color: colors.error, fontSize: 13, marginBottom: 10, lineHeight: 18 },
  textCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16 },
  textCardTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  recognized: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  matchThumb: { width: 48, height: 48, borderRadius: 8, marginRight: 12, backgroundColor: colors.background },
  matchInfo: { flex: 1 },
  matchName: { fontWeight: '700', color: colors.textPrimary, fontSize: 15 },
  matchMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  matchCta: { color: colors.brandPrimary, fontWeight: '800', fontSize: 15 },
  lockWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  lockGlyph: { fontSize: 44, marginBottom: 12 },
  lockTitle: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  lockBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  lockBtn: { width: '100%', maxWidth: 320, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  lockBtnPrimary: { backgroundColor: colors.brandPrimary },
  lockBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  lockBtnGhost: { borderWidth: 1.5, borderColor: colors.brandPrimary },
  lockBtnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
});

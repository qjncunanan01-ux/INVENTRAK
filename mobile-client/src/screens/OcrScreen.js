import { useState } from 'react';
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
import { imageUrl, scanProductPhoto } from '../api';
import { colors } from '../theme';

// OCR module (reviewer requirement): snap or pick a product photo, the
// backend runs tesseract OCR and fuzzy-matches the catalog, and the customer
// taps the best match to prefill a checkout inquiry.
export default function OcrScreen({ navigation }) {
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(null);
  const [text, setText] = useState('');
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');

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
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({
            base64: true,
            quality: 0.6,
            allowsEditing: true,
            aspect: [4, 3],
          })
        : await ImagePicker.launchImageLibraryAsync({
            base64: true,
            quality: 0.6,
            allowsEditing: true,
            aspect: [4, 3],
          });

      if (result.canceled || !result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('No image', 'Could not read the selected image.');
        return;
      }
      setImage(asset.uri);
      setMatches([]);
      setText('');
      await runOcr(asset.base64);
    } catch (err) {
      setError('Could not open the camera / photo library.');
    }
  };

  const runOcr = async (base64) => {
    setBusy(true);
    setError('');
    try {
      const data = await scanProductPhoto({ image: base64 });
      setText(data.text || '');
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      if ((!data.text || !data.text.trim()) && (!data.matches || data.matches.length === 0)) {
        setError('No text recognized. Try a clearer, well-lit photo of the label.');
      }
    } catch (err) {
      setError(err.message || 'OCR failed. Is the backend running?');
    } finally {
      setBusy(false);
    }
  };

  const addToOrder = (match) => {
    navigation.navigate('OrdersTab', {
      screen: 'OrderInquiry',
      params: { preselectId: match.id },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.title}>Scan a product</Text>
      <Text style={styles.subtitle}>
        Take a photo of a product label or upload one — we'll recognize it and match it to
        the catalog so you can order it in one tap.
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
          <Text style={styles.textCardTitle}>Recognized text</Text>
          <Text style={styles.recognized}>{text.trim().slice(0, 400)}</Text>
        </View>
      ) : null}

      {matches.length > 0 ? (
        <View>
          <Text style={styles.sectionTitle}>Matched products</Text>
          {matches.map((m) => (
            <TouchableOpacity key={m.id} style={styles.matchCard} onPress={() => addToOrder(m)} activeOpacity={0.7}>
              {m.image ? (
                <Image source={{ uri: imageUrl(m.image) }} style={styles.matchThumb} resizeMode="cover" />
              ) : null}
              <View style={styles.matchInfo}>
                <Text style={styles.matchName}>{m.name}</Text>
                <Text style={styles.matchMeta}>P{m.price} · {(m.score * 100).toFixed(0)}% match</Text>
              </View>
              <Text style={styles.matchCta}>+ Order</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});

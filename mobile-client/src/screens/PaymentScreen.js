import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { updateInquiryPayment } from '../api';
import { colors } from '../theme';

// GCash payment step (reviewer requirement): after placing a GCash/card order,
// the customer lands here to actually pay — a QR to scan in the GCash app (or
// an open payment link when a PayMongo checkout session exists), then confirm
// with "I've paid" which marks the inquiry paid for the admin dashboard.
export default function PaymentScreen({ route, navigation }) {
  const { inquiryId, payment } = route.params || {};
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);

  if (!payment) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No payment step</Text>
        <Text style={styles.subtitle}>This order does not require an online payment.</Text>
      </View>
    );
  }

  const openLink = () => {
    if (payment.payment_url) {
      Linking.openURL(payment.payment_url).catch(() => {
        Alert.alert('Cannot open', 'Could not open the payment link.');
      });
    }
  };

  const confirmPaid = async () => {
    setBusy(true);
    try {
      await updateInquiryPayment({ id: inquiryId }, { payment_status: 'paid' });
      setPaid(true);
      Alert.alert('Payment confirmed 🎉', 'Your order is now marked as paid. The store will review it shortly.', [
        { text: 'View my orders', onPress: () => navigation.navigate('InquiryHistory') },
        { text: 'OK', style: 'cancel' },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not confirm payment.');
    } finally {
      setBusy(false);
    }
  };

  if (paid) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigGlyph}>✓</Text>
        <Text style={styles.title}>Payment confirmed</Text>
        <Text style={styles.subtitle}>Your order is marked as paid.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pay via {String(payment.payment_method || 'gcash').toUpperCase()}</Text>
      <Text style={styles.subtitle}>
        Scan the QR with your GCash app (or open the payment link) to complete payment for this order.
      </Text>

      <View style={styles.qrCard}>
        {payment.payment_qr ? (
          <Image source={{ uri: payment.payment_qr }} style={styles.qr} resizeMode="contain" />
        ) : (
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        )}
      </View>

      <View style={styles.refCard}>
        <Text style={styles.refLabel}>Payment reference</Text>
        <Text style={styles.refCode}>{payment.payment_reference}</Text>
        <Text style={styles.refHint}>Mention this reference when paying.</Text>
      </View>

      {payment.payment_url ? (
        <TouchableOpacity style={[styles.btn, styles.btnLink]} onPress={openLink}>
          <Text style={styles.btnLinkText}>Open payment link ↗</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={confirmPaid} disabled={busy}>
        <Text style={styles.btnPrimaryText}>{busy ? 'Confirming...' : "I've paid — confirm"}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>In demo mode no real charge is made — tap confirm to continue.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  bigGlyph: { fontSize: 44, color: colors.success, fontWeight: '700', marginBottom: 10 },
  qrCard: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  qr: { width: 220, height: 220, borderRadius: 8 },
  refCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 16, alignItems: 'center' },
  refLabel: { fontSize: 12, color: colors.textSecondary },
  refCode: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginVertical: 4, letterSpacing: 1 },
  refHint: { fontSize: 12, color: colors.textSecondary },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnLink: { borderWidth: 1.5, borderColor: colors.info },
  btnLinkText: { color: colors.info, fontSize: 15, fontWeight: '700' },
  hint: { textAlign: 'center', color: colors.textSecondary, fontSize: 12, marginTop: 4 },
});

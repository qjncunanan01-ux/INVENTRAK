import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { updateInquiryPayment } from '../api';
import { useThemeColors } from '../theme-context';
import Dialog from '../Dialog';

// GCash payment step (reviewer requirement): after placing a GCash/card order,
// the customer lands here to actually pay — a QR to scan in the GCash app (or
// an open payment link when a PayMongo checkout session exists), then confirm
// with "I've paid" which marks the inquiry paid for the admin dashboard.
export default function PaymentScreen({ route, navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { inquiryId, payment } = route.params || {};
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showError, setShowError] = useState(false);

  const goToOrders = () => navigation.navigate('InquiryHistory');

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
        setErrorMsg('Could not open the payment link. Check your connection and try again.');
        setShowError(true);
      });
    }
  };

  const confirmPaid = async() => {
    setBusy(true);
    try {
      await updateInquiryPayment({ id: inquiryId }, { payment_status: 'paid' });
      setPaid(true);
    } catch (err) {
      setErrorMsg(err.message || 'Could not confirm payment. Please try again.');
      setShowError(true);
    } finally {
      setBusy(false);
    }
  };

  if (paid) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigGlyph}>✓</Text>
        <Text style={styles.title}>Payment confirmed</Text>
        <Text style={styles.subtitle}>
          Your order is now marked as paid. The store will review it shortly.
        </Text>
        {/* Clear next step instead of a dead-end confirmation: the paid state
            must lead somewhere (Alert.alert would be invisible on web). */}
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { minWidth: 220, marginTop: 20 }]}
          onPress={goToOrders}
          activeOpacity={0.85}
        >
          <Text style={styles.btnPrimaryText}>View my orders</Text>
        </TouchableOpacity>
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
        <Text style={styles.refCode}>{payment.payment_reference || '—'}</Text>
        <Text style={styles.refHint}>Mention this reference when paying.</Text>
      </View>

      {payment.payment_url ? (
        <TouchableOpacity style={[styles.btn, styles.btnLink]} onPress={openLink}>
          <Text style={styles.btnLinkText}>Open payment link ↗</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={confirmPaid} disabled={busy}>
        <Text style={styles.btnPrimaryText}>{busy ? 'Confirming...' : 'I\'ve paid — confirm'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>In demo mode no real charge is made — tap confirm to continue.</Text>

      {/* Payment error dialog (cross-platform) */}
      <Dialog
        visible={showError}
        glyph="⚠️"
        title="Payment issue"
        body={errorMsg}
        confirmLabel="Got it"
        onConfirm={() => setShowError(false)}
        onCancel={() => setShowError(false)}
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  bigGlyph: { color: colors.success, fontSize: 44, fontWeight: '700', marginBottom: 10 },
  btn: { alignItems: 'center', borderRadius: 12, marginBottom: 10, paddingVertical: 14 },
  btnLink: { borderColor: colors.info, borderWidth: 1.5 },
  btnLinkText: { color: colors.info, fontSize: 15, fontWeight: '700' },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: 24 },
  container: { backgroundColor: colors.background, flex: 1, padding: 20 },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 4, textAlign: 'center' },
  qr: { borderRadius: 8, height: 220, width: 220 },
  qrCard: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  refCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, marginBottom: 16, padding: 14 },
  refCode: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: 1, marginVertical: 4 },
  refHint: { color: colors.textSecondary, fontSize: 12 },
  refLabel: { color: colors.textSecondary, fontSize: 12 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20, textAlign: 'center' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
});

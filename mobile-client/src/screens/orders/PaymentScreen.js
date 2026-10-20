import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { updateInquiryPayment } from '../../api';
import { useThemeColors } from '../../theme-context';
import Dialog from '../../Dialog';

// GCash receipt references are reviewed by an admin. Card is a labelled demo
// transaction only; no card data is collected and no charge is made.
export default function PaymentScreen({ route, navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { inquiryId, payment } = route.params || {};
  const liveGateway = payment && payment.payment_provider === 'paymongo';
  const [busy, setBusy] = useState(false);
  const [paymentResult, setPaymentResult] = useState(null);
  const [customerReference, setCustomerReference] = useState('');
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

  const submitPayment = async() => {
    setBusy(true);
    try {
      const response = await updateInquiryPayment(
        { id: inquiryId },
        payment.payment_method === 'card'
          ? { demo_card_confirmed: true }
          : { customer_reference: customerReference.trim() },
      );
      setPaymentResult(response.payment_status);
    } catch (err) {
      setErrorMsg(err.message || 'Could not confirm payment. Please try again.');
      setShowError(true);
    } finally {
      setBusy(false);
    }
  };

  if (paymentResult) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigGlyph}>{paymentResult === 'paid' ? '✓' : '⌛'}</Text>
        <Text style={styles.title}>{paymentResult === 'paid' ? 'Demo transaction complete' : 'Payment sent for review'}</Text>
        <Text style={styles.subtitle}>
          {paymentResult === 'paid'
            ? 'This was a simulated card transaction. No card was charged. The store will review your order.'
            : 'The store will verify your GCash receipt reference. The order will stay unpaid until the store confirms it.'}
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
      <Text style={styles.title}>{payment.payment_method === 'card' ? 'Demo card transaction' : 'Pay via GCash'}</Text>
      <Text style={styles.subtitle}>
        {payment.payment_method === 'card'
          ? 'This demo creates a transaction record only. Do not enter card details; no real card is charged.'
          : liveGateway
            ? 'Pay using the secure checkout link or QR, then enter the receipt reference from your GCash confirmation. The store verifies it.'
            : 'No live GCash gateway is configured. Contact Sylver for its current GCash payment details, then enter the receipt reference from your transfer. The store verifies it.'}
      </Text>

      {payment.payment_method === 'card' ? (
        <View style={styles.demoCard}>
          <Text style={styles.demoCardGlyph}>💳</Text>
          <Text style={styles.demoCardTitle}>No card details required</Text>
          <Text style={styles.demoCardBody}>The button below completes a clearly labelled demo transaction.</Text>
        </View>
      ) : liveGateway ? (
        <View style={styles.qrCard}>
          {payment.payment_qr ? (
            <Image source={{ uri: payment.payment_qr }} style={styles.qr} resizeMode="contain" />
          ) : (
            <ActivityIndicator size="large" color={colors.brandPrimary} />
          )}
        </View>
      ) : (
        <View style={styles.demoCard}>
          <Text style={styles.demoCardGlyph}>₱</Text>
          <Text style={styles.demoCardTitle}>Manual GCash verification</Text>
          <Text style={styles.demoCardBody}>This demo does not receive money. Confirm the store's payment details directly before transferring.</Text>
        </View>
      )}

      <View style={styles.refCard}>
        <Text style={styles.refLabel}>Order payment reference</Text>
        <Text style={styles.refCode}>{payment.payment_reference || '—'}</Text>
        <Text style={styles.refHint}>{payment.payment_method === 'card' ? 'Demo transaction ID' : 'Use this reference if requested by the payment provider.'}</Text>
      </View>

      {payment.payment_method === 'gcash' ? (
        <TextInput
          style={styles.referenceInput}
          value={customerReference}
          onChangeText={setCustomerReference}
          placeholder="GCash receipt reference number"
          autoCapitalize="characters"
          maxLength={100}
          accessibilityLabel="GCash receipt reference number"
        />
      ) : null}

      {payment.payment_method === 'gcash' && payment.payment_url ? (
        <TouchableOpacity style={[styles.btn, styles.btnLink]} onPress={openLink}>
          <Text style={styles.btnLinkText}>Open payment link ↗</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, payment.payment_method === 'gcash' && !customerReference.trim() && styles.btnDisabled]}
        onPress={submitPayment}
        disabled={busy || (payment.payment_method === 'gcash' && !customerReference.trim())}
      >
        <Text style={styles.btnPrimaryText}>
          {busy ? 'Submitting...' : payment.payment_method === 'card' ? 'Complete demo transaction' : 'Submit receipt reference'}
        </Text>
      </TouchableOpacity>
      {payment.payment_method === 'gcash' ? <Text style={styles.hint}>Payment remains unverified until the store checks your receipt reference.</Text> : null}

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
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: 24 },
  container: { backgroundColor: colors.background, flex: 1, padding: 20 },
  demoCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, marginBottom: 16, padding: 24 },
  demoCardGlyph: { fontSize: 36, marginBottom: 8 },
  demoCardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  demoCardBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 4, textAlign: 'center' },
  qr: { borderRadius: 8, height: 220, width: 220 },
  referenceInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 10, borderWidth: 1, color: colors.textPrimary, marginBottom: 12, padding: 14 },
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

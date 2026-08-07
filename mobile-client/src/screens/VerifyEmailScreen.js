import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { resendVerification, setSessionDetails, verifyEmail } from '../api';
import { colors } from '../theme';

// Shown right after signup (and from the Account tab / login for unverified
// accounts): the 6-digit code sent to the customer's email (and phone, when
// one was provided) is redeemed here. The code is single-use and expires.
export default function VerifyEmailScreen({ route, navigation }) {
  const email = route.params?.email || '';
  const phone = route.params?.phone || null;
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      Alert.alert('Validation', 'Please enter the 6-digit code.');
      return;
    }
    setLoading(true);
    try {
      await verifyEmail({ code: code.trim() });
      setSessionDetails({ email, verified: true });
      Alert.alert('Verified 🎉', 'Your account has been verified. Welcome to INVENTRAK!', [
        { text: 'Continue', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Verification Failed', `${err.message || 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await resendVerification({ email });
      Alert.alert('Code Sent', 'A new verification code has been sent to your email.');
    } catch (err) {
      Alert.alert('Request Failed', `${err.message || 'Please try again later.'}`);
    } finally {
      setResending(false);
    }
  };

  const sentTo = phone ? `${email} (and SMS to ${phone})` : email;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.emoji}>📧</Text>
        <Text style={styles.title}>Verify Your Account</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit verification code to {'\n'}
          <Text style={styles.subtitleStrong}>{sentTo}</Text>. Enter it below to prove this
          account is really yours. It expires in 30 minutes.
        </Text>

        <Text style={styles.label}>Verification code</Text>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
          placeholder="••••••"
          keyboardType="number-pad"
          maxLength={6}
          editable={!loading}
        />

        {loading ? (
          <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.spinner} />
        ) : (
          <TouchableOpacity style={[styles.button, styles.primary]} onPress={handleVerify} activeOpacity={0.8}>
            <Text style={styles.primaryText}>Verify</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.linkRow} onPress={handleResend} disabled={loading || resending}>
          <Text style={styles.linkResend}>
            {resending ? 'Sending…' : "Didn't get it? Resend code"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkRow} onPress={() => navigation.goBack()} disabled={loading}>
          <Text style={styles.linkSkip}>Skip for now — I'll verify later</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 44, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', color: colors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  subtitleStrong: { color: colors.textPrimary, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  codeInput: {
    backgroundColor: colors.surface,
    padding: 16,
    marginBottom: 16,
    borderRadius: 12,
    color: colors.textPrimary,
    fontSize: 24,
    letterSpacing: 10,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  primary: { backgroundColor: colors.brandPrimary },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  spinner: { marginTop: 18 },
  linkRow: { marginTop: 16, alignItems: 'center' },
  linkResend: { fontSize: 14, color: colors.info, fontWeight: '600' },
  linkSkip: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
});

import { useMemo, useState } from 'react';
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
import { forgotPassword, resetPassword } from '../api';
import BackButton from '../BackButton';
import { useThemeColors } from '../theme-context';

// Mirrors the backend policy exactly (backend/src/password-policy.js): the
// server is the source of truth, this is just a friendlier pre-check.
function passwordErrors(pw) {
  const checks = [
    ['At least 8 characters', pw.length >= 8],
    ['An uppercase letter (A-Z)', /[A-Z]/.test(pw)],
    ['A lowercase letter (a-z)', /[a-z]/.test(pw)],
    ['A number (0-9)', /\d/.test(pw)],
    ['A symbol (!@#$%)', /[^A-Za-z0-9]/.test(pw)],
  ];
  return checks;
}

export default function ForgotPasswordScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState('email'); // 'email' -> 'reset'
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => passwordErrors(password), [password]);
  const allMet = checks.every(([, ok]) => ok);

  const sendCode = async() => {
    const mail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      Alert.alert('Validation', 'Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      // The endpoint always succeeds — it never reveals whether the email has
      // an account (no user-enumeration oracle). If it does exist, a 6-digit
      // code is emailed (and SMS providers can be wired the same way).
      await forgotPassword({ email: mail });
      setStage('reset');
    } catch (err) {
      Alert.alert('Request Failed', `${err.message || 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const doReset = async() => {
    if (!code.trim()) {
      Alert.alert('Validation', 'Please enter the 6-digit code from your email.');
      return;
    }
    if (!allMet) {
      Alert.alert('Validation', 'Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and symbol.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ code: code.trim(), password });
      Alert.alert('Success', 'Your password has been updated. Log in with your new password.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Reset Failed', `${err.message || 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Pinned outside the ScrollView so it never scrolls away. */}
      <BackButton navigation={navigation} label="Back" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          {stage === 'email'
            ? 'Enter your account email and we\'ll send you a reset code.'
            : 'Enter the 6-digit code from your email and choose a new password.'}
        </Text>

        {stage === 'email' ? (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!loading}
            />
            {loading ? (
              <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.spinner} />
            ) : (
              <TouchableOpacity style={[styles.button, styles.primary]} onPress={sendCode} activeOpacity={0.8}>
                <Text style={styles.primaryText}>Send Reset Code</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ✓ If an account exists for {email.trim()}, a 6-digit code was sent to it.
                Check your inbox (and spam).
              </Text>
            </View>

            <Text style={styles.label}>Reset code</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              editable={!loading}
            />

            <Text style={styles.label}>New password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="8+ chars, A-Z, a-z, 0-9, symbol"
              secureTextEntry
              editable={!loading}
            />
            {password.length > 0 ? (
              <View style={styles.checklist}>
                {checks.map(([label, ok]) => (
                  <Text key={label} style={[styles.checkItem, ok ? styles.checkOk : styles.checkBad]}>
                    {ok ? '✓' : '○'} {label}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text style={styles.label}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat your new password"
              secureTextEntry
              editable={!loading}
            />

            {loading ? (
              <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.spinner} />
            ) : (
              <TouchableOpacity style={[styles.button, styles.primary]} onPress={doReset} activeOpacity={0.8}>
                <Text style={styles.primaryText}>Update Password</Text>
              </TouchableOpacity>
            )}
          </>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  button: { alignItems: 'center', borderRadius: 14, marginTop: 6, paddingVertical: 16 },
  checkBad: { color: colors.textSecondary },
  checkItem: { fontSize: 13, marginBottom: 3 },
  checkOk: { color: colors.success },
  checklist: { marginBottom: 14, paddingHorizontal: 4 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  flex: { backgroundColor: colors.background, flex: 1 },
  infoBox: { backgroundColor: '#e8f5e9', borderRadius: 12, marginBottom: 16, padding: 12 },
  infoText: { color: '#2e7d32', fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    marginBottom: 14,
    padding: 14,
  },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 6 },
  primary: { backgroundColor: colors.brandPrimary },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  spinner: { marginTop: 18 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 28, textAlign: 'center' },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginBottom: 4, textAlign: 'center' },
});

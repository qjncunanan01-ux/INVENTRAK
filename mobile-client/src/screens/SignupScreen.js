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
import { API_BASE_URL, register, setSessionDetails, setSessionUsername, setToken } from '../api';
import { colors } from '../theme';

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

export default function SignupScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => passwordErrors(password), [password]);
  const allMet = checks.every(([, ok]) => ok);

  const handleSignup = async () => {
    const uname = username.trim();
    const mail = email.trim();
    const ph = phone.trim().replace(/\s+/g, '');
    if (!uname || !mail || !ph || !password) {
      Alert.alert('Validation', 'Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      Alert.alert('Validation', 'Please enter a valid email address.');
      return;
    }
    if (!/^\+?[0-9]{9,15}$/.test(ph)) {
      Alert.alert('Validation', 'Please enter a valid mobile number (e.g. 09171234567).');
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
    if (!consent) {
      Alert.alert(
        'Consent Required',
        'Please agree to the Data Privacy Act notice to create your account.'
      );
      return;
    }

    setLoading(true);
    try {
      const response = await register({ username: uname, password, email: mail, phone: ph });
      if (response.token) setToken(response.token);
      const loggedInAs = response.user?.username || uname;
      setSessionUsername(loggedInAs);
      setSessionDetails({
        email: mail,
        verified: response.user?.email_verified !== false,
      });
      // New accounts are UNVERIFIED: walk straight into the verification
      // screen (code was emailed/SMS'd). After verifying, the app pops back
      // to wherever the customer came from (e.g. a filled-in order form).
      if (response.user?.email_verified === false) {
        navigation.replace('VerifyEmail', { email: mail, phone: ph, notify: response.notify });
        return;
      }
      // Legacy/verified account: pop back to the tabs as before.
      const state = navigation.getState();
      if (state && state.routes && state.routes.length >= 2) {
        navigation.goBack();
      } else {
        navigation.replace('Main', { username: loggedInAs });
      }
    } catch (err) {
      Alert.alert(
        'Sign Up Failed',
        `${err.message || 'Please try again.'}\n\nAPI: ${API_BASE_URL}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join INVENTRAK to start ordering supplies.</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Choose a username"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />

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

        <Text style={styles.label}>Mobile number (required)</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="09171234567 or +639171234567"
          keyboardType="phone-pad"
          editable={!loading}
        />
        <Text style={styles.hint}>
          Used to send you a verification code and SMS updates about your orders.
        </Text>

        <Text style={styles.label}>Password</Text>
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

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Repeat your password"
          secureTextEntry
          editable={!loading}
        />

        {/* Data Privacy Act (RA 10173) consent */}
        <TouchableOpacity
          style={styles.consentBox}
          onPress={() => setConsent((c) => !c)}
          activeOpacity={0.8}
          disabled={loading}
        >
          <View style={[styles.checkbox, consent && styles.checkboxOn]}>
            {consent ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <View style={styles.consentTextWrap}>
            <Text style={styles.consentTitle}>Data Privacy Act (RA 10173) Consent</Text>
            <Text style={styles.consentBody}>
              I agree to INVENTRAK collecting and processing my name, email address, and mobile
              number for the purposes of account verification, order inquiries, and status
              updates by email and SMS. INVENTRAK will never sell or share my personal data,
              and I can request its deletion at any time.
            </Text>
          </View>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.spinner} />
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.primary]}
            onPress={handleSignup}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryText}>Create Account</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.replace('Login')}
          disabled={loading}
        >
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.linkStrong}>Log In</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: 6 },
  hint: { fontSize: 11, color: colors.textSecondary, marginTop: -8, marginBottom: 10, paddingHorizontal: 4 },
  input: {
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 14,
    borderRadius: 12,
    color: colors.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  checklist: { marginBottom: 14, paddingHorizontal: 4 },
  checkItem: { fontSize: 13, marginBottom: 3 },
  checkOk: { color: colors.success },
  checkBad: { color: colors.textSecondary },
  consentBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cfe3f7',
    padding: 12,
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#7ba7d0',
    marginRight: 10,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  consentTextWrap: { flex: 1 },
  consentTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  consentBody: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  primary: { backgroundColor: colors.brandPrimary },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  spinner: { marginTop: 18 },
  linkRow: { marginTop: 18, alignItems: 'center' },
  linkText: { fontSize: 14, color: colors.textSecondary },
  linkStrong: { color: colors.brandPrimary, fontWeight: '700' },
});

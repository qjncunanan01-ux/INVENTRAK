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
import { API_BASE_URL, register, setToken } from '../api';
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
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => passwordErrors(password), [password]);
  const allMet = checks.every(([, ok]) => ok);

  const handleSignup = async () => {
    const uname = username.trim();
    const mail = email.trim();
    if (!uname || !mail || !password) {
      Alert.alert('Validation', 'Please fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      Alert.alert('Validation', 'Please enter a valid email address.');
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
      const response = await register({ username: uname, password, email: mail });
      if (response.token) setToken(response.token);
      navigation.replace('Main', { username: response.user?.username || uname });
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
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 28 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: 6 },
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
  button: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  primary: { backgroundColor: colors.brandPrimary },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  spinner: { marginTop: 18 },
  linkRow: { marginTop: 18, alignItems: 'center' },
  linkText: { fontSize: 14, color: colors.textSecondary },
  linkStrong: { color: colors.brandPrimary, fontWeight: '700' },
});

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Button, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { login, setSessionDetails, setSessionUsername, setToken } from '../api';
import BackButton from '../BackButton';
import { useThemeColors } from '../theme-context';

export default function LoginScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [username, setUsername] = useState('customer');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutLeft, setLockoutLeft] = useState(0);

  // Live countdown while the account is locked out (429 + retryAfterSeconds).
  useEffect(() => {
    if (lockoutLeft <= 0) return undefined;
    const t = setInterval(() => setLockoutLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockoutLeft]);

  const handleLogin = async () => {
    if (lockoutLeft > 0) return;
    if (!username.trim()) {
      Alert.alert('Validation', 'Please enter a username');
      return;
    }
    setLoading(true);
    try {
      const response = await login({ username, password });
      if (response.token) setToken(response.token);
      const loggedInAs = response.user?.username || username;
      setSessionUsername(loggedInAs);
      setSessionDetails({
        email: response.user?.email || loggedInAs,
        verified: response.user?.email_verified !== false,
      });
      // Pop back to the tabs instead of replacing Main: a guest who logged in
      // at checkout keeps their filled-in inquiry form and tab position.
      const state = navigation.getState();
      if (state && state.routes && state.routes.length >= 2) {
        navigation.goBack();
      } else {
        navigation.replace('Main', { username: loggedInAs });
      }
    } catch (err) {
      // Brute-force lockout: the generated client attaches err.status + the
      // parsed body, so we can surface the wait and disable the button.
      if (err && err.status === 429) {
        const secs = err.body && err.body.retryAfterSeconds;
        if (secs) setLockoutLeft(secs);
        Alert.alert(
          'Too Many Attempts',
          secs
            ? `Too many failed logins. Try again in ${secs}s.`
            : 'Too many failed login attempts. Try again later.'
        );
      } else {
        Alert.alert(
          'Login Failed',
          err.message || 'Please check your credentials.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top-left back pill — escaping the login screen is one obvious tap
          (the old bottom link was easy to miss). */}
      <BackButton navigation={navigation} label="Back to store" />
      <Text style={styles.title}>INVENTRAK</Text>
      <Text style={styles.subtitle}>Customer Portal</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        autoCapitalize="none"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        editable={!loading}
      />
      {loading ? (
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      ) : (
        <Button
          title={lockoutLeft > 0 ? `Locked — try again in ${lockoutLeft}s` : 'Login'}
          onPress={handleLogin}
          color={colors.brandPrimary}
          disabled={lockoutLeft > 0}
        />
      )}

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.replace('Signup')}
        disabled={loading}
      >
        <Text style={styles.linkText}>
          Don't have an account? <Text style={styles.linkStrong}>Create one</Text>
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkRow}
        onPress={() => navigation.navigate('ForgotPassword')}
        disabled={loading}
      >
        <Text style={styles.linkForgot}>Forgot password?</Text>
      </TouchableOpacity>

    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 4, textAlign: 'center', color: colors.brandPrimary },
  subtitle: { fontSize: 16, marginBottom: 8, textAlign: 'center', color: colors.textSecondary },
  input: { backgroundColor: colors.surface, padding: 14, marginBottom: 16, borderRadius: 10, color: colors.textPrimary, fontSize: 16 },
  linkRow: { alignItems: 'center', marginTop: 14 },
  linkText: { fontSize: 14, color: colors.textSecondary },
  linkStrong: { color: colors.brandPrimary, fontWeight: '700' },
  linkForgot: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
});

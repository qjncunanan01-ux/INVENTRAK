import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getApiBaseUrl, loadSavedApiUrl, login, setApiBaseUrl, setSessionUsername, setToken } from '../api';
import { colors } from '../theme';

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('customer');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl());
  const [loading, setLoading] = useState(false);
  const [lockoutLeft, setLockoutLeft] = useState(0);

  // Restore a persisted API URL override (set on a previous session).
  useEffect(() => {
    loadSavedApiUrl().then(setApiUrl);
  }, []);

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
    if (setApiBaseUrl(apiUrl)) {
      setApiUrl(getApiBaseUrl());
    } else {
      Alert.alert('Invalid API URL', 'Enter a full URL like http://192.168.1.50:4001');
      return;
    }
    setLoading(true);
    try {
      const response = await login({ username, password });
      if (response.token) setToken(response.token);
      const loggedInAs = response.user?.username || username;
      setSessionUsername(loggedInAs);
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
          `${err.message || 'Please check your credentials.'}\n\nAPI: ${getApiBaseUrl()}`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const looksLocalOnly =
    /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(apiUrl) && Platform.OS !== 'web';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>INVENTRAK</Text>
      <Text style={styles.subtitle}>Customer Portal</Text>
      <Text style={styles.apiLabel}>API SERVER URL</Text>
      <TextInput
        style={[styles.input, styles.apiInput]}
        value={apiUrl}
        onChangeText={setApiUrl}
        placeholder="http://192.168.1.50:4001"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!loading}
      />
      {looksLocalOnly ? (
        <Text style={styles.apiHint}>
          ⚠ This is an emulator/simulator address — a real phone can't reach it.
          Edit it to your PC's IP (same Wi-Fi) or your deployed API URL.
        </Text>
      ) : (
        <Text style={styles.apiHint}>Saved on this device. Edit if your network changed.</Text>
      )}
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
        onPress={() => navigation.goBack()}
        disabled={loading}
      >
        <Text style={styles.linkBack}>&larr; Back to store</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 4, textAlign: 'center', color: colors.brandPrimary },
  subtitle: { fontSize: 16, marginBottom: 8, textAlign: 'center', color: colors.textSecondary },
  apiLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.textSecondary, marginBottom: 6, textAlign: 'center' },
  apiInput: { marginBottom: 6 },
  apiHint: { fontSize: 11, textAlign: 'center', color: colors.warning, marginBottom: 16, paddingHorizontal: 8, lineHeight: 15 },
  input: { backgroundColor: colors.surface, padding: 14, marginBottom: 16, borderRadius: 10, color: colors.textPrimary, fontSize: 16 },
  linkRow: { alignItems: 'center', marginTop: 14 },
  linkText: { fontSize: 14, color: colors.textSecondary },
  linkStrong: { color: colors.brandPrimary, fontWeight: '700' },
  linkBack: { fontSize: 14, color: colors.info, marginTop: 4 },
});

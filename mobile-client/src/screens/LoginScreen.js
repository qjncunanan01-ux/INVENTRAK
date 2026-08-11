import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Button, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { googleAuth, login, setSessionDetails, setSessionUsername, setToken } from '../api';
import BackButton from '../BackButton';
import { useThemeColors } from '../theme-context';

// Google OAuth client IDs come from build-time env vars (Google Cloud Console
// → Credentials → OAuth client ID). Google's auth hook THROWS without a
// platform client ID, so the button is only mounted when at least one is set
// — username/password login always works regardless.
const GOOGLE_CLIENT_IDS = {
  clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
};
const hasGoogleConfig = Object.values(GOOGLE_CLIENT_IDS).some(Boolean);

function GoogleSignInButton({ onSuccess, disabled, styles }) {
  // Runs the Google OAuth flow; on success hands the parent the id_token,
  // which the backend verifies and exchanges for an INVENTRAK session.
  const [request, response, promptAsync] = Google.useAuthRequest(GOOGLE_CLIENT_IDS);

  useEffect(() => {
    if (response?.type === 'success' && response.authentication?.idToken) {
      onSuccess(response.authentication.idToken);
    } else if (response?.type === 'error') {
      Alert.alert('Google Sign-In Failed', response.error?.description || 'Please try again.');
    }
  }, [response]);

  return (
    <View style={styles.googleWrap}>
      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.divider} />
      </View>
      <TouchableOpacity
        style={[styles.googleBtn, disabled && styles.googleBtnDisabled]}
        onPress={() => promptAsync()}
        disabled={disabled || !request}
        activeOpacity={0.85}
        accessibilityLabel="Continue with Google"
      >
        <MaterialCommunityIcons name="google" size={20} color="#DB4437" />
        <Text style={styles.googleBtnText}>Continue with Google</Text>
      </TouchableOpacity>
    </View>
  );
}

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

  // Shared post-login: store the session, then pop back to the tabs instead
  // of replacing Main — a guest who logged in at checkout keeps their
  // filled-in inquiry form and tab position.
  const finishLogin = (response, fallbackName) => {
    if (response.token) setToken(response.token);
    const loggedInAs = response.user?.username || fallbackName;
    setSessionUsername(loggedInAs);
    setSessionDetails({
      email: response.user?.email || loggedInAs,
      verified: response.user?.email_verified !== false,
    });
    const state = navigation.getState();
    if (state && state.routes && state.routes.length >= 2) {
      navigation.goBack();
    } else {
      navigation.replace('Main', { username: loggedInAs });
    }
  };

  const handleLogin = async () => {
    if (lockoutLeft > 0) return;
    if (!username.trim()) {
      Alert.alert('Validation', 'Please enter a username');
      return;
    }
    setLoading(true);
    try {
      const response = await login({ username, password });
      finishLogin(response, username);
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

  // Google path: the backend verifies the id_token, then finds-or-creates the
  // account by email (linking google_sub to an existing password account).
  const handleGoogleIdToken = async (idToken) => {
    setLoading(true);
    try {
      const response = await googleAuth({ idToken });
      finishLogin(response, 'customer');
    } catch (err) {
      Alert.alert('Google Sign-In Failed', err.message || 'Please try again.');
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

      {hasGoogleConfig ? (
        <GoogleSignInButton onSuccess={handleGoogleIdToken} disabled={loading} styles={styles} />
      ) : null}

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
  // ---- Google sign-in ----
  googleWrap: { marginTop: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  divider: { flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.1)' },
  dividerText: { marginHorizontal: 10, fontSize: 12, color: colors.textSecondary },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.14)',
    borderRadius: 10,
    paddingVertical: 14,
  },
  googleBtnDisabled: { opacity: 0.5 },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
});

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Button, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { API_BASE_URL, login, setSessionDetails, setSessionUsername, setToken } from '../api';
import BackButton from '../BackButton';
import { useThemeColors } from '../theme-context';
import AnimatedEntry from '../AnimatedEntry';

// Demo accounts the quick-fill buttons populate (matches the seeded accounts
// on both backends). Customer is the buyer demo; Staff is the on-phone
// inventory role — staff are MOBILE-only by design (the web admin refuses
// them), so this is where a staff account signs in. Kept in one place so the
// buttons and any hints can never drift apart.
const DEMO_ACCOUNTS = [
  {
    username: 'customer',
    password: 'customer123',
    label: 'Customer',
    note: 'demo account',
    icon: 'account-circle-outline',
  },
  {
    username: 'staff',
    password: 'staff123',
    label: 'Inventory Staff',
    note: 'mobile scan & count',
    icon: 'clipboard-check-outline',
  },
];

// Google sign-in runs through the backend OAuth relay (/api/auth/google/start
// → Google → /api/auth/google/callback): Expo Go deep links (exp://…) can't be
// registered as Google OAuth redirect URIs and the old auth.expo.io proxy is
// deprecated, so the backend holds the web client's secret and exchanges the
// code itself, then deep-links back into the app with a normal session token.
function GoogleSignInButton({ onPress, disabled, styles }) {
  return (
    <TouchableOpacity
      style={[styles.googleBtn, disabled && styles.googleBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityLabel="Continue with Google"
    >
      <MaterialCommunityIcons name="google" size={20} color="#DB4437" />
      <Text style={styles.googleBtnText}>Continue with Google</Text>
    </TouchableOpacity>
  );
}

// Parses ?a=b&c=d from a deep link without relying on Hermes URL support.
function parseQuery(url) {
  const i = url.indexOf('?');
  const query = i >= 0 ? url.slice(i + 1) : '';
  const out = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    // URLSearchParams encodes spaces as '+' (e.g. "Jerico Cunanan" →
    // "Jerico+Cunanan"); decodeURIComponent alone leaves '+' as-is, so
    // normalize it to a space first (standard form-encoding semantics).
    const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
    const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    if (k) out[k] = v;
  }
  return out;
}

export default function LoginScreen({ navigation }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [username, setUsername] = useState('');
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
      // Role unlocks staff tools on the phone (staff/admin only).
      role: response.user?.role,
    });
    const state = navigation.getState();
    if (state && state.routes && state.routes.length >= 2) {
      navigation.goBack();
    } else {
      navigation.replace('Main', { username: loggedInAs });
    }
  };

  // One tap fills a demo account so the phone demo never types credentials
  // on stage (and the form stays clean for real accounts).
  const fillDemo = (account) => {
    setUsername(account.username);
    setPassword(account.password);
  };

  const handleLogin = async() => {
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
            : 'Too many failed login attempts. Try again later.',
        );
      } else {
        Alert.alert(
          'Login Failed',
          err.message || 'Please check your credentials.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // Google path: open the backend relay in a browser. The backend redirects
  // to Google, exchanges the code with the web client's secret, and deep-links
  // back here with a session token (plus the account identity).
  const handleGoogleRelay = async() => {
    setLoading(true);
    try {
      // Browser build: full-page navigation (no in-app browser session). The
      // backend returns to `/#/google-auth?token=…` — hash-based, because the
      // static host has no SPA fallback — and App.js applies the session when
      // the app boots back up.
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const returnUrl = `${window.location.origin}/#/google-auth`;
        window.location.href = `${API_BASE_URL}/api/auth/google/start?returnUrl=${encodeURIComponent(returnUrl)}`;
        return;
      }
      const returnUrl = Linking.createURL('google-auth');
      const startUrl = `${API_BASE_URL}/api/auth/google/start?returnUrl=${encodeURIComponent(returnUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
      if (result.type === 'success' && result.url) {
        const params = parseQuery(result.url);
        const token = params.token;
        if (token) {
          finishLogin(
            {
              token,
              user: {
                username: params.username || 'customer',
                role: params.role || 'customer',
                email: params.email || '',
                email_verified: params.email_verified !== '0',
              },
            },
            params.username || 'customer',
          );
          return;
        }
        Alert.alert(
          'Google Sign-In Failed',
          params.error ? `Google error: ${params.error}` : 'No token returned. Please try again.',
        );
      } else if (result.type === 'cancel') {
        // User backed out of the Google page — stay on the login screen.
      } else {
        const msg = result.error && (result.error.message || result.error.description);
        Alert.alert('Google Sign-In Failed', msg || 'Please try again.');
      }
    } catch (err) {
      Alert.alert('Google Sign-In Failed', (err && err.message) || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[colors.brandPrimary, colors.brandSecondary || colors.brandPrimary, colors.background]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.container}
    >
      <AnimatedEntry delay={0}>
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
        {/* Quick-fill: one tap per demo role — buyer and on-phone staff. */}
        <View style={styles.demoRow}>
          {DEMO_ACCOUNTS.map((account) => (
            <TouchableOpacity
              key={account.username}
              style={styles.demoBtn}
              onPress={() => fillDemo(account)}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityLabel={`Fill ${account.label} demo account`}
            >
              <MaterialCommunityIcons name={account.icon} size={18} color={colors.brandPrimary} />
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.demoBtnText}>Fill {account.label}</Text>
                <Text style={styles.demoBtnNote}>{account.note}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
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

        <View style={styles.googleWrap}>
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.divider} />
          </View>
          <GoogleSignInButton onPress={handleGoogleRelay} disabled={loading} styles={styles} />
        </View>

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

      </AnimatedEntry>
    </LinearGradient>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 32, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 16, marginBottom: 8, textAlign: 'center' },
  input: { backgroundColor: colors.surface, borderRadius: 10, color: colors.textPrimary, fontSize: 16, marginBottom: 16, padding: 14 },
  demoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  demoBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  demoBtnText: { color: colors.brandPrimary, fontSize: 13, fontWeight: '700' },
  demoBtnNote: { color: colors.textSecondary, fontSize: 11 },
  linkRow: { alignItems: 'center', marginTop: 14 },
  linkText: { color: colors.textSecondary, fontSize: 14 },
  linkStrong: { color: colors.brandPrimary, fontWeight: '700' },
  linkForgot: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  // ---- Google sign-in ----
  googleWrap: { marginTop: 20 },
  dividerRow: { alignItems: 'center', flexDirection: 'row', marginBottom: 14 },
  divider: { backgroundColor: 'rgba(0,0,0,0.1)', flex: 1, height: 1 },
  dividerText: { color: colors.textSecondary, fontSize: 12, marginHorizontal: 10 },
  googleBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  googleBtnDisabled: { opacity: 0.5 },
  googleBtnText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
});

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { login, setSessionDetails, setSessionUsername, setToken, clearToken, clearSession } from '../api';

// The ONLY role this app admits — mirrors the server's canAccessStaffPortal.
const STAFF_TIER_ONLY = ['staff'];

// Build marker: the login screen prints its own version so an outdated
// install is obvious at a glance instead of surfacing as scan failures.
const APP_VERSION =
  (typeof Constants !== 'undefined' && Constants && Constants.expoConfig && Constants.expoConfig.version) || '1.2.0';
import { useThemeColors } from '../theme-context';

// Staff sign-in — this app is EXCLUSIVELY for Inventory Staff. The login
// sends portal: 'staff', which the SERVER enforces (403 staff_app_exclusive
// for admins/owners/customers), with a client-side role gate as defense in
// depth. No signup, no Google, no password reset: staff accounts are
// provisioned by the owner on the web admin.
const DEMO_STAFF = { username: 'staff', password: 'staff123' };

export default function LoginScreen() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    if (busy) return;
    const u = username.trim();
    if (!u || !password) {
      setError('Enter the username and password your supervisor gave you.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await login({ username: u, password, portal: 'staff' });
      // Defense in depth: the server already refused non-staff roles with
      // 403 staff_app_exclusive, but if a legacy/unexpected response ever
      // slips a non-staff session through, reject it before any session
      // state is committed.
      if (!STAFF_TIER_ONLY.includes(response.user?.role)) {
        clearToken();
        clearSession();
        setError('This app is exclusively for Inventory Staff. Admins and owners use the web admin dashboard.');
        return;
      }
      if (response.token) setToken(response.token);
      setSessionUsername(response.user?.username || u);
      setSessionDetails({
        email: response.user?.email || u,
        verified: response.user?.email_verified !== false,
        role: response.user?.role,
      });
      // Successful login flips the session, and the App gate renders the
      // work tabs on the next render — no navigation call needed.
    } catch (err) {
      // 403 staff_app_exclusive = a non-staff role (admin/owner/customer);
      // 401 = wrong credentials; 429 = lockout.
      if (err && err.status === 403) {
        setError('This app is exclusively for Inventory Staff. Admins and owners use the web admin dashboard.');
      } else if (err && err.status === 429) {
        setError('Too many attempts — wait a moment and try again.');
      } else {
        setError('Sign-in failed. Check your credentials and the connection.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.brand}>
        <View style={styles.logoBox}>
          <Text style={styles.logoGlyph}>▦</Text>
        </View>
        <Text style={styles.title}>INVENTRAK Staff</Text>
        <Text style={styles.subtitle}>
          QR scanning · physical counts · adjustment requests
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. staff"
          placeholderTextColor={colors.textSecondary}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.textSecondary}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.btn} onPress={signIn} disabled={busy} activeOpacity={0.85}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Start shift</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setUsername(DEMO_STAFF.username);
            setPassword(DEMO_STAFF.password);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.demoHint}>Fill demo staff account</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>
        Staff-exclusive: accounts are created by the owner on the web admin.
        Admin/owner accounts sign in there, not here; customers use the INVENTRAK app.
      </Text>

      {/* Build marker: instantly answers "which build is this phone running?". */}
      <Text style={styles.versionNote}>v{APP_VERSION}</Text>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24 },
    brand: { alignItems: 'center', marginBottom: 28 },
    logoBox: {
      width: 64,
      height: 64,
      borderRadius: 16,
      backgroundColor: colors.brandPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    logoGlyph: { color: '#fff', fontSize: 30, fontWeight: '900' },
    title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
    card: { backgroundColor: colors.surface, borderRadius: 16, padding: 18 },
    label: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
    input: {
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    error: { color: colors.error, fontSize: 13, marginBottom: 10, lineHeight: 18 },
    btn: {
      backgroundColor: colors.brandPrimary,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    demoHint: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 14,
    },
    footer: {
      fontSize: 11,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 16,
      marginTop: 24,
    },
    versionNote: { fontSize: 11, color: colors.textSecondary, opacity: 0.7, marginTop: 10, textAlign: 'center' },
  });

import { useMemo } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { clearSession, clearToken, useSessionEmail, useSessionUsername, useSessionVerified } from '../api';
import { useCart } from '../cart-context';
import { useThemeColors } from '../theme-context';

export default function AccountScreen({ route, navigation }) {
  const { colors, dark, toggleDark } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Accounts are optional (guest-first): the header and menu adapt. The
  // session is the source of truth; route params are only a first-mount hint.
  const session = useSessionUsername(null);
  const isLoggedIn = !!session;
  const verified = useSessionVerified();
  const sessionEmail = useSessionEmail();
  const username = session || route.params?.username || 'Guest';
  // Logging out clears the basket too: on a shared device the next customer
  // must not inherit the previous user's cart (badge + items).
  const { clear } = useCart();

  const handleLogout = () => {
    clear();
    clearToken();
    clearSession();
    // Reset the tabs back to a fresh guest session.
    const auth = navigation.getParent()?.getParent();
    if (auth) {
      auth.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation.navigate('Main');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{username.charAt(0).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.name}>{username}</Text>
          <Text style={styles.role}>
            {isLoggedIn ? 'Customer Account' : 'Browsing as a guest'}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {isLoggedIn && !verified ? (
          <TouchableOpacity
            style={styles.verifyBanner}
            onPress={() => navigation.navigate('VerifyEmail', { email: sessionEmail || '' })}
            activeOpacity={0.85}
          >
            <Text style={styles.verifyIcon}>🔔</Text>
            <View style={styles.verifyBody}>
              <Text style={styles.verifyTitle}>Verify your email</Text>
              <Text style={styles.verifyDesc}>
                Tap to enter the verification code we sent to {sessionEmail || 'your inbox'}.
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ) : null}

        {isLoggedIn ? (
          <>
            <Text style={styles.sectionTitle}>My Orders</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('OrdersTab', { screen: 'InquiryHistory' })}
            >
              <Text style={styles.menuGlyph}>✓</Text>
              <View style={styles.menuBody}>
                <Text style={styles.menuTitle}>Order History</Text>
                <Text style={styles.menuDesc}>Track the status of your inquiries</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('OrdersTab', { screen: 'OrderInquiry' })}
            >
              <Text style={styles.menuGlyph}>✎</Text>
              <View style={styles.menuBody}>
                <Text style={styles.menuTitle}>New Order Inquiry</Text>
                <Text style={styles.menuDesc}>Request pricing for supplies</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.guestCard}>
            <Text style={styles.guestTitle}>Log in or create an account</Text>
            <Text style={styles.guestSub}>
              Browsing is free — an account is only needed when you place an
              order inquiry.
            </Text>
            <TouchableOpacity style={styles.guestBtnPrimary} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.guestBtnPrimaryText}>Log In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.guestBtnSecondary} onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.guestBtnSecondaryText}>Create Account</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>Discover</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigation.navigate('CatalogTab', { screen: 'Recommendations' })}
        >
          <Text style={styles.menuGlyph}>★</Text>
          <View style={styles.menuBody}>
            <Text style={styles.menuTitle}>Recommendations</Text>
            <Text style={styles.menuDesc}>ABC-classified top supplies</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigation.navigate('CatalogTab', { screen: 'Products' })}
        >
          <Text style={styles.menuGlyph}>☰</Text>
          <View style={styles.menuBody}>
            <Text style={styles.menuTitle}>Browse Products</Text>
            <Text style={styles.menuDesc}>View the full product catalog</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Preferences: dark-mode switcher (persisted on the device). */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuGlyph}>{dark ? '🌙' : '☀️'}</Text>
          <View style={styles.menuBody}>
            <Text style={styles.menuTitle}>Dark Mode</Text>
            <Text style={styles.menuDesc}>
              {dark ? 'Night theme is on' : 'Switch to the night theme'}
            </Text>
          </View>
          <Switch
            value={dark}
            onValueChange={toggleDark}
            trackColor={{ false: 'rgba(0,0,0,0.15)', true: colors.brandPrimary }}
            thumbColor="#fff"
          />
        </View>

        {isLoggedIn ? (
          <>
            <View style={styles.spacer} />
            <TouchableOpacity style={styles.logout} onPress={handleLogout}>
              <Text style={styles.logoutText}>Log Out</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.brandPrimary,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.brandPrimary },
  name: { color: '#fff', fontSize: 20, fontWeight: '800' },
  role: { color: '#fff', opacity: 0.85, fontSize: 13, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textSecondary, marginLeft: 20, marginTop: 20, marginBottom: 8 },
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: 'rgba(240, 212, 138, 0.6)',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
  },
  verifyIcon: { fontSize: 20, marginRight: 10 },
  verifyBody: { flex: 1 },
  verifyTitle: { fontSize: 14, fontWeight: '700', color: colors.warning },
  verifyDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
  },
  menuGlyph: { fontSize: 20, color: colors.brandPrimary, fontWeight: '700', width: 32 },
  menuBody: { flex: 1 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  menuDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textSecondary },
  spacer: { height: 12 },
  guestCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  guestTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  guestSub: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginTop: 6, marginBottom: 16 },
  guestBtnPrimary: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  guestBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestBtnSecondary: { borderWidth: 1.5, borderColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  guestBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  logout: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 32,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.error,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '700' },
});

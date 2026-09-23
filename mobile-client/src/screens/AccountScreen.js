import { useMemo } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { clearSession, clearToken, logout, STAFF_TOOLS_ROLES, ROLE_LABELS, useSessionEmail, useSessionRole, useSessionUsername, useSessionVerified } from '../api';
import { useCart } from '../cart-context';
import { useThemeColors } from '../theme-context';

// Shopee-style tinted icon disc for menu rows (matches the Home quick-action
// grid): a pastel circular badge with a deeper accent icon per action.
function MenuIcon({ name, tint, styles }) {
  return (
    <View style={[styles.menuIconDisc, { backgroundColor: tint.bg }]}>
      <MaterialCommunityIcons name={name} size={20} color={tint.fg} />
    </View>
  );
}

const MENU_TINTS = {
  history: { bg: '#e8eaf6', fg: '#3f51b5' },
  inquiry: { bg: '#e8f0fe', fg: '#1565c0' },
  recs: { bg: '#fff3e0', fg: '#f9a825' },
  products: { bg: '#e0f2f1', fg: '#00796b' },
  theme: { bg: '#fde8ec', fg: '#e23744' },
};

export default function AccountScreen({ route, navigation }) {
  const { colors, dark, toggleDark } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Accounts are optional (guest-first): the header and menu adapt. The
  // session is the source of truth; route params are only a first-mount hint.
  const session = useSessionUsername(null);
  const isLoggedIn = !!session;
  const verified = useSessionVerified();
  const sessionEmail = useSessionEmail();
  // Staff/admin accounts get a dedicated on-phone scan-and-count entry.
  const role = useSessionRole();
  const isStaff = STAFF_TOOLS_ROLES.includes(role);
  const username = session || route.params?.username || 'Guest';
  // Logging out clears the basket too: on a shared device the next customer
  // must not inherit the previous user's cart (badge + items).
  const { clear } = useCart();

  const handleLogout = () => {
    clear();
    // Revoke the token server-side too, then clear local state (fire-and-
    // forget: the local session is cleared even if the network is down).
    logout();
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
            {!isLoggedIn
              ? 'Browsing as a guest'
              : isStaff
                ? `${ROLE_LABELS[role] || 'Staff'} Account · staff tools unlocked`
                : 'Customer Account'}
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
              <MenuIcon name="clipboard-text-clock-outline" tint={MENU_TINTS.history} styles={styles} />
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
              <MenuIcon name="file-document-edit-outline" tint={MENU_TINTS.inquiry} styles={styles} />
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

        {isStaff ? (
          <>
            <Text style={styles.sectionTitle}>Staff Tools</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('CatalogTab', { screen: 'QrScan' })}
            >
              <MenuIcon name="qrcode-scan" tint={{ bg: '#e0f2f1', fg: '#00796b' }} styles={styles} />
              <View style={styles.menuBody}>
                <Text style={styles.menuTitle}>Scan & Count Stock</Text>
                <Text style={styles.menuDesc}>
                  Scan a product QR code, record the physical count — corrections go to the owner for approval
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Discover</Text>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => navigation.navigate('CatalogTab', { screen: 'Recommendations' })}
        >
          <MenuIcon name="star-circle-outline" tint={MENU_TINTS.recs} styles={styles} />
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
          <MenuIcon name="view-grid-outline" tint={MENU_TINTS.products} styles={styles} />
          <View style={styles.menuBody}>
            <Text style={styles.menuTitle}>Browse Products</Text>
            <Text style={styles.menuDesc}>View the full product catalog</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        {/* Preferences: dark-mode switcher (persisted on the device). */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.menuItem}>
          {/* Theme icon follows the effective mode (moon in dark, sun in light) */}
          <MenuIcon name={dark ? 'weather-night' : 'white-balance-sunny'} tint={MENU_TINTS.theme} styles={styles} />
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
  avatar: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    marginRight: 14,
    width: 56,
  },
  avatarText: { color: colors.brandPrimary, fontSize: 24, fontWeight: '800' },
  chevron: { color: colors.textSecondary, fontSize: 22 },
  container: { backgroundColor: colors.background, flex: 1 },
  guestBtnPrimary: { alignItems: 'center', backgroundColor: colors.brandPrimary, borderRadius: 12, marginBottom: 10, paddingVertical: 13 },
  guestBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  guestBtnSecondary: { alignItems: 'center', borderColor: colors.brandPrimary, borderRadius: 12, borderWidth: 1.5, paddingVertical: 13 },
  guestBtnSecondaryText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  guestCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 18,
  },
  guestSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16, marginTop: 6 },
  guestTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  header: {
    alignItems: 'center',
    backgroundColor: colors.brandPrimary,
    flexDirection: 'row',
    paddingBottom: 20,
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  logout: {
    alignItems: 'center',
    borderColor: colors.error,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 32,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 14,
  },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '700' },
  menuBody: { flex: 1 },
  menuDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  menuIconDisc: {
    alignItems: 'center',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    marginRight: 12,
    width: 38,
  },
  menuItem: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 10,
    marginHorizontal: 16,
    padding: 14,
  },
  menuTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  name: { color: '#fff', fontSize: 20, fontWeight: '800' },
  role: { color: '#fff', fontSize: 13, marginTop: 2, opacity: 0.85 },
  sectionTitle: { color: colors.textSecondary, fontSize: 15, fontWeight: '700', marginBottom: 8, marginLeft: 20, marginTop: 20 },
  spacer: { height: 12 },
  verifyBanner: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: 'rgba(240, 212, 138, 0.6)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
  },
  verifyBody: { flex: 1 },
  verifyDesc: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
  verifyIcon: { fontSize: 20, marginRight: 10 },
  verifyTitle: { color: colors.warning, fontSize: 14, fontWeight: '700' },
});

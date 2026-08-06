import { StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { clearToken } from '../api';
import { colors } from '../theme';

export default function AccountScreen({ route, navigation }) {
  const username = route.params?.username || 'Customer';

  const handleLogout = () => {
    clearToken();
    // Reset the auth stack so the next login remounts the tabs with fresh
    // params (a stale mounted Main would keep the previous username).
    const auth = navigation.getParent()?.getParent();
    if (auth) {
      auth.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } else {
      navigation.navigate('Landing');
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
          <Text style={styles.role}>Customer Account</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
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

        <View style={styles.spacer} />
        <TouchableOpacity style={styles.logout} onPress={handleLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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

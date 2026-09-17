import { useMemo } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { logoutAndClear, useSession } from '../api';
import { useThemeColors } from '../theme-context';

// Account — minimal on purpose: who is on shift, dark mode, and logout.
// No orders, no profile editing, no customer features. Only Inventory Staff
// can hold a session here (enforced by the server's portal gate + login).
export default function AccountScreen() {
  const { colors, dark, toggleDark } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { username } = useSession();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarGlyph}>{String(username || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.username}>{username || '—'}</Text>
        <Text style={styles.role}>Inventory Staff</Text>
        <Text style={styles.note}>
          This device is a work tool: scan tags, count stock, and request
          adjustments. Approvals happen on the web admin.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Dark mode</Text>
          <Switch
            value={dark}
            onValueChange={toggleDark}
            trackColor={{ false: colors.border, true: colors.brandSecondary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logoutAndClear} activeOpacity={0.85}>
        <Text style={styles.logoutText}>End shift (log out)</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        Logging out revokes this session on the server, so a lost device cannot
        be reused by whoever picks it up.
      </Text>
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: 16 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.brandPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    avatarGlyph: { color: '#fff', fontSize: 24, fontWeight: '900' },
    username: { fontSize: 19, fontWeight: '800', color: colors.textPrimary },
    role: { fontSize: 13, fontWeight: '700', color: colors.brandPrimary, marginTop: 2 },
    note: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginTop: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    logoutBtn: {
      backgroundColor: colors.error,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 6,
    },
    logoutText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    footer: {
      fontSize: 11,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 16,
      marginTop: 16,
    },
  });

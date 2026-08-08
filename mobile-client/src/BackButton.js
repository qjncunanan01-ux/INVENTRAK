import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from './theme-context';

// Consistent, discoverable back control for every headerless screen (Search,
// Login, Signup, Forgot Password, Verify Email). A labeled pill beats a bare
// chevron — users see where it goes and the hit area is thumb-friendly.
export default function BackButton({ navigation, label = 'Back', dark = false, style }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.btn, dark ? styles.btnDark : styles.btnLight, style]}
      onPress={() => navigation.goBack()}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      activeOpacity={0.7}
    >
      <Text style={[styles.text, dark ? styles.textDark : styles.textLight]}>‹ {label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors) => StyleSheet.create({
  btn: {
    position: 'absolute',
    top: 52,
    left: 14,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    zIndex: 10,
  },
  btnLight: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  btnDark: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  text: { fontSize: 15, fontWeight: '700' },
  textLight: { color: colors.textPrimary },
  textDark: { color: '#fff' },
});

// Shared empty-state component: glyph + title + sub + optional CTA. Standard
// pattern across the app (Cart already had one inline) so every empty list
// looks intentional instead of a bare line of grey text.
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors } from './theme-context';

export default function EmptyState({ glyph, title, sub, actionLabel, onAction, style }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.glyph}>{glyph || '📭'}</Text>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.btn} onPress={onAction} activeOpacity={0.85}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  btn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 12,
    marginTop: 18,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  glyph: { fontSize: 44, marginBottom: 12 },
  sub: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  wrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40 },
});

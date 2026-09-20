import { useMemo } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors } from './theme-context';

// RN-web implements Modal animations as CSS keyframes and unmounts the modal
// only after `animationend` fires. In embedded webviews (like this app's
// preview) the animation can stall, leaving a click-through ghost overlay on
// screen. Native handles 'fade' natively and reliably, so: animate on native,
// skip the animation on web (RN-web resolves 'none' synchronously).
//
// Exported so every other Modal in the app (login gate, PDP add-to-cart,
// checkout auth-gate) uses the same rule instead of inlining the platform
// check — one source of truth for the ghost-modal workaround.
export const MODAL_ANIMATION = Platform.OS === 'web' ? 'none' : 'fade';

// Cross-platform dialog: RN-web's Alert.alert is a NO-OP, so any confirm /
// success / error prompt that must also work on the react-native-web preview
// (and look identical on native) has to be an in-app Modal. CartScreen,
// OrderInquiryScreen and PaymentScreen all use this instead of Alert.
//
// Props: visible, glyph (emoji above title), title, body, confirmLabel,
// onConfirm, cancelLabel (optional), onCancel, confirmDanger (red confirm).
export default function Dialog({
  visible,
  glyph,
  title,
  body,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  confirmDanger = false,
}) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType={MODAL_ANIMATION} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {glyph ? <Text style={styles.glyph}>{glyph}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <TouchableOpacity
            style={[styles.btn, confirmDanger ? styles.btnDanger : styles.btnPrimary]}
            onPress={onConfirm}
            activeOpacity={0.85}
          >
            <Text style={confirmDanger ? styles.btnDangerText : styles.btnPrimaryText}>
              {confirmLabel}
            </Text>
          </TouchableOpacity>
          {cancelLabel && onCancel ? (
            <TouchableOpacity onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.cancel}>{cancelLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
      flex: 1,
      justifyContent: 'center',
      padding: 28,
    },
    body: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 18,
      marginTop: 8,
      textAlign: 'center',
    },
    btn: { alignItems: 'center', borderRadius: 12, marginBottom: 10, paddingVertical: 14, width: '100%' },
    btnDanger: { backgroundColor: colors.error },
    btnDangerText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    btnPrimary: { backgroundColor: colors.brandPrimary },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    cancel: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
    card: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 16,
      maxWidth: 380,
      padding: 24,
      width: '100%',
    },
    glyph: { fontSize: 34, marginBottom: 8 },
    title: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  });

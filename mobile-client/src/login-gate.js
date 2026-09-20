import { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSessionUsername } from './api';
import { MODAL_ANIMATION } from './Dialog';
import { useThemeColors } from './theme-context';

// One consistent "account required" gate for every member-only action (adding
// to the cart, ordering a recommended bundle, ...). Guests see the modal and
// the action NEVER runs; logged-in customers just run the action. Screens own
// one hook call and render {gateModal} once at the end of their tree.
export function useLoginGate(
  navigation,
  { title = 'Log in to add to cart', body = 'Browsing is free, but adding products to your cart is a member feature. Create a free account or log in to start ordering.' } = {},
) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [visible, setVisible] = useState(false);
  const isLoggedIn = !!useSessionUsername(null);

  // Runs `action` only for signed-in users; guests get the modal instead.
  // Returns true when the action ran (handy for "if (requireLogin(fn)) { ... }").
  const requireLogin = (action) => {
    if (isLoggedIn) {
      action();
      return true;
    }
    setVisible(true);
    return false;
  };

  const gateModal = (
    // Native animates reliably; RN-web's CSS animation can stall in embedded
    // webviews and leave a click-through ghost — so skip it there.
    // (MODAL_ANIMATION is the shared web-safe rule — see Dialog.js.)
    <Modal
      visible={visible}
      transparent
      animationType={MODAL_ANIMATION}
      onRequestClose={() => setVisible(false)}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.glyph}>🔒</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => {
              setVisible(false);
              navigation.navigate('Signup');
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryText}>Create Account</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => {
              setVisible(false);
              navigation.navigate('Login');
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.btnGhostText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.cancel}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return { isLoggedIn, requireLogin, gateModal };
}

const createStyles = (colors) => StyleSheet.create({
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
  btnGhost: { backgroundColor: colors.surface, borderColor: colors.brandPrimary, borderWidth: 1.5 },
  btnGhostText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },
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

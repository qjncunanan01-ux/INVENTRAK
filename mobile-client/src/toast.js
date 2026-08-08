// Tiny global toast (Shopee/Lazada "added to cart" pattern). Actions that
// used to be silent — the PLP quick-add +, flash-sale + — now pop a small
// pill at the bottom of the screen with optional "View" shortcut.
//
// Pure module state + subscription (same pattern as the session store), so
// any screen can call showToast() without prop drilling. Mount <Toaster />
// once at the root (inside CartProvider so it overlays the navigator).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from './theme-context';

let listeners = new Set();
let current = null;
let hideTimer = null;

// message   — the toast text (e.g. 'Added to cart')
// opts      — { actionLabel, onAction, duration }
export function showToast(message, opts = {}) {
  const next = {
    id: Date.now() + Math.random(),
    message,
    actionLabel: opts.actionLabel || null,
    onAction: opts.onAction || null,
    duration: opts.duration || 2200,
  };
  current = next;
  clearTimeout(hideTimer);
  listeners.forEach((fn) => fn(next));
  hideTimer = setTimeout(dismissToast, next.duration);
}

export function dismissToast() {
  clearTimeout(hideTimer);
  current = null;
  listeners.forEach((fn) => fn(null));
}

// Fixed bottom pill, absolutely positioned so it floats above the tab bar.
export function Toaster() {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [toast, setToast] = useState(current);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    const unsub = (t) => setToast(t);
    listeners.add(unsub);
    return () => listeners.delete(unsub);
  }, []);

  // Slide up + fade in for every new toast.
  useEffect(() => {
    if (!toast) return;
    opacity.setValue(0);
    translateY.setValue(18);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [toast, opacity, translateY]);

  if (!toast) return null;
  return (
    // box-none lets touches pass through everything except the pill itself.
    <Animated.View style={[styles.wrap, { opacity, transform: [{ translateY }] }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.pill}
        activeOpacity={0.92}
        accessibilityRole="button"
        onPress={() => {
          if (toast.onAction) toast.onAction();
          dismissToast();
        }}
      >
        <Text style={styles.text} numberOfLines={1}>{toast.message}</Text>
        {toast.actionLabel ? <Text style={styles.action}>{toast.actionLabel}</Text> : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 76, // clears the ~60px tab bar + safe area
    alignItems: 'center',
    zIndex: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22320f',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    maxWidth: '86%',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  action: { color: colors.brandSecondary, fontSize: 13, fontWeight: '800', marginLeft: 12 },
});

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';

/**
 * Apple Liquid Glass-inspired card for React Native.
 * Uses LinearGradient + opacity for a frosted glass look (no blur — RN doesn't
 * support backdrop-filter natively). Pairs with the admin's LiquidGlassCard.
 *
 * Props:
 * - children: card content
 * - intensity: 'low' | 'medium' | 'high'
 * - preset: animation preset passed to MotiView
 * - style: additional container styles
 */
export default function GlassCard({
  children,
  intensity = 'medium',
  preset = 'fade',
  style,
}) {
  const intensityConfig = {
    low: { colors: ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.05)'], border: 'rgba(255,255,255,0.15)' },
    medium: { colors: ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.08)'], border: 'rgba(255,255,255,0.22)' },
    high: { colors: ['rgba(255,255,255,0.25)', 'rgba(255,255,255,0.12)'], border: 'rgba(255,255,255,0.30)' },
  };

  const config = intensityConfig[intensity] || intensityConfig.medium;

  const animationPresets = {
    fade: { from: { opacity: 0 }, animate: { opacity: 1 } },
    slide: { from: { opacity: 0, translateY: 20 }, animate: { opacity: 1, translateY: 0 } },
    pop: { from: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 } },
    bounce: { from: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: 1 } },
  };

  const anim = animationPresets[preset] || animationPresets.fade;

  return (
    <MotiView
      from={anim.from}
      animate={anim.animate}
      transition={{ type: 'spring', damping: 20, stiffness: 200 }}
      style={[
        styles.container,
        { borderColor: config.border },
        style,
      ]}
    >
      <LinearGradient
        colors={config.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.content}>
          {children}
        </View>
      </LinearGradient>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});

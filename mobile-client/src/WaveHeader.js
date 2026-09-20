import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from './theme-context';

/**
 * WaveHeader — Haikei.app-style gradient + wave overlay.
 * Replaces the flat-color header with a premium gradient + SVG wave bottom.
 *
 * Props:
 *   height    – total header height (px)
 *   children  – content inside the gradient (brand, search, etc.)
 */
export default function WaveHeader({ height = 180, children }) {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors, height), [colors, height]);

  return (
    <View style={styles.wrapper}>
      <LinearGradient
        colors={[colors.brandPrimary, colors.brandSecondary || colors.brandPrimary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {children}
      </LinearGradient>
      {/* Haikei-style wave SVG overlay at the bottom of the gradient */}
      <View style={styles.waveContainer}>
        <WaveSVG color={colors.background} />
      </View>
    </View>
  );
}

/**
 * Inline SVG wave shape using React Native View clipping — creates a smooth
 * curved bottom edge like Haikee.app's wave generator. Pure CSS/RN, no SVG lib needed.
 */
function WaveSVG({ color }) {
  return (
    <View style={waveStyles.container}>
      {/* Large wave curve */}
      <View style={[waveStyles.curve1, { backgroundColor: color }]} />
      {/* Smaller overlapping wave for depth */}
      <View style={[waveStyles.curve2, { backgroundColor: color, opacity: 0.5 }]} />
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    height: 40,
    overflow: 'hidden',
    width: '100%',
  },
  curve1: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    height: 50,
    left: -20,
    position: 'absolute',
    right: -20,
    top: 10,
  },
  curve2: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    height: 40,
    left: -10,
    position: 'absolute',
    right: -10,
    top: 20,
  },
});

const createStyles = (colors, height) =>
  StyleSheet.create({
    gradient: {
      minHeight: height,
      paddingBottom: 30,
      paddingHorizontal: 16,
      paddingTop: 18,
    },
    waveContainer: {
      marginTop: -20,
      zIndex: 10,
    },
    wrapper: {
      overflow: 'hidden',
      width: '100%',
    },
  });

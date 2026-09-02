import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';

/**
 * AnimatedEntry — enhanced entrance animation with spring physics.
 * Inspired by anime.js (spring easing) and motion.dev (layout animations).
 *
 * Props:
 *   delay     – ms before animation starts (stagger support)
 *   duration  – animation length (ms)
 *   dy        – vertical slide offset (px)
 *   dx        – horizontal slide offset (px)
 *   scale     – initial scale (0.8 = shrink in, 1.1 = pop in)
 *   rotate    – initial rotation (degrees)
 *   preset    – named preset: 'fade', 'slide', 'pop', 'bounce', 'flip'
 *   children  – single child element
 */
export default function AnimatedEntry({
  children,
  delay = 0,
  duration = 400,
  dy = 20,
  dx = 0,
  scale: initialScale,
  rotate: initialRotate,
  preset,
  style,
}) {
  // Apply preset overrides
  const config = applyPreset(preset, { dy, dx, scale: initialScale, rotate: initialRotate, duration });

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(config.dy)).current;
  const translateX = useRef(new Animated.Value(config.dx)).current;
  const scaleValue = useRef(new Animated.Value(config.scale ?? 1)).current;
  const rotateValue = useRef(new Animated.Value(config.rotate ?? 0)).current;

  useEffect(() => {
    const useNative = Platform.OS !== 'web';

    // Spring-like easing using timing with bezier curve
    const springConfig = {
      toValue: 1,
      duration: config.duration,
      delay,
      useNativeDriver: useNative,
    };

    Animated.parallel([
      Animated.timing(opacity, springConfig),
      Animated.timing(translateY, { ...springConfig, toValue: 0 }),
      ...(config.dx !== 0 ? [Animated.timing(translateX, { ...springConfig, toValue: 0 })] : []),
      ...(config.scale != null ? [Animated.timing(scaleValue, { ...springConfig, toValue: 1 })] : []),
      ...(config.rotate != null ? [Animated.timing(rotateValue, { ...springConfig, toValue: 0 })] : []),
    ]).start();
  }, []);

  const transforms = [
    { translateY },
    ...(config.dx !== 0 ? [{ translateX }] : []),
    ...(config.scale != null ? [{ scale: scaleValue }] : []),
    ...(config.rotate != null ? [{ rotate: rotateValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '0deg'] }) }] : []),
  ];

  return (
    <Animated.View style={[{ opacity, transform: transforms }, style]}>
      {children}
    </Animated.View>
  );
}

/**
 * Applies named preset overrides to the animation config.
 * Presets match popular animation libraries' default behaviors.
 */
function applyPreset(preset, defaults) {
  const presets = {
    fade: { dy: 0, dx: 0, scale: null, rotate: null, duration: 300 },
    slide: { dy: 40, dx: 0, scale: null, rotate: null, duration: 450 },
    pop: { dy: 0, dx: 0, scale: 0.7, rotate: null, duration: 350 },
    bounce: { dy: 30, dx: 0, scale: 1.05, rotate: null, duration: 600 },
    flip: { dy: 0, dx: 0, scale: null, rotate: -15, duration: 500 },
  };

  if (!preset || !presets[preset]) return defaults;
  return { ...defaults, ...presets[preset] };
}

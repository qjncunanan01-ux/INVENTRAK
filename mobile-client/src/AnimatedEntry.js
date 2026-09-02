import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';

/**
 * AnimatedEntry — wraps a child and fades+slides it in on mount.
 * Watermelon UI / Motion Primitives style entrance animations.
 *
 * Props:
 *   delay   – ms before this item starts (for stagger)
 *   duration– animation length (ms)
 *   dy      – vertical offset to slide from (px)
 *   children– single child element
 */
export default function AnimatedEntry({
  children,
  delay = 0,
  duration = 350,
  dy = 18,
  style,
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(dy)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[{ opacity, transform: [{ translateY }] }, style]}
    >
      {children}
    </Animated.View>
  );
}

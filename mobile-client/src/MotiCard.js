import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';

/**
 * MotiCard — Reanimated-powered card with spring entrance + press gesture.
 * Replaces PressableScale with native-thread 60fps animations.
 *
 * Props:
 *   delay       – ms before entrance animation starts
 *   entrance    – 'fade' | 'slide' | 'pop' | 'bounce'
 *   onPress     – tap handler
 *   style       – container style
 *   children    – card content
 */
export default function MotiCard({
  children,
  delay = 0,
  entrance = 'slide',
  onPress,
  style,
  contentStyle,
  accessibilityLabel,
  accessibilityRole,
}) {
  const progress = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 400 })
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;

    let translateY = 0;
    let translateX = 0;
    let scaleVal = 1;
    let opacity = 1;

    if (entrance === 'slide') {
      translateY = interpolate(p, [0, 1], [30, 0], Extrapolation.CLAMP);
      opacity = interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP);
    } else if (entrance === 'fade') {
      opacity = interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP);
    } else if (entrance === 'pop') {
      scaleVal = interpolate(p, [0, 1], [0.7, 1], Extrapolation.CLAMP);
      opacity = interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP);
    } else if (entrance === 'bounce') {
      translateY = interpolate(p, [0, 1], [40, 0], Extrapolation.CLAMP);
      scaleVal = interpolate(p, [0, 0.8, 1], [0.9, 1.05, 1], Extrapolation.CLAMP);
      opacity = interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP);
    }

    return {
      transform: [
        { translateY },
        ...(translateX !== 0 ? [{ translateX }] : []),
        { scale: scaleVal * scale.value },
      ],
      opacity,
    };
  });

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(scale.value, { damping: 15, stiffness: 400 }) }],
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPressIn={() => { scale.value = 0.96; }}
        onPressOut={() => { scale.value = 1; }}
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
      >
        <Animated.View style={[pressStyle, contentStyle]}>
          {children}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

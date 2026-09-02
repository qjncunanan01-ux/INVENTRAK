import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Text } from 'react-native';

/**
 * AnimatedNumber — counts from 0 to target using Reanimated.
 * Smooth 60fps counter on the native thread.
 *
 * Props:
 *   target    – final number
 *   duration  – animation length (ms)
 *   prefix    – text before (e.g. "P")
 *   suffix    – text after
 *   style     – text style
 */
export default function AnimatedNumber({
  target,
  duration = 1000,
  prefix = '',
  suffix = '',
  style,
}) {
  const sv = useSharedValue(0);

  useEffect(() => {
    sv.value = withTiming(target, { duration });
  }, [target, duration]);

  const props = useAnimatedProps(() => {
    const val = Math.round(sv.value);
    return {
      text: `${prefix}${val.toLocaleString()}${suffix}`,
    };
  });

  return (
    <AnimatedText animatedProps={props} style={style} />
  );
}

// We need a custom animated Text that accepts animatedProps
const AnimatedText = Animated.createAnimatedComponent(Text);

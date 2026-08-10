import { useRef } from 'react';
import { Animated, Pressable, Platform } from 'react-native';

// Subtle tactile feedback (Shopee/Lazada-style): the child scales down to
// 0.95 while pressed and springs back when released. Wraps a Pressable so it
// works identically on native and react-native-web.
//
// `scaleTo`/`duration` tune the effect; the default is intentionally subtle.
// Extra TouchableOpacity props (onPress, activeOpacity, ...) pass through to
// the underlying Pressable. `pressableStyle` (optional) overrides the inner
// Pressable's layout — e.g. { flexDirection: 'row' } for chips or
// { alignItems: 'stretch' } for cards whose text must stay left-aligned.
export default function PressableScale({
  children,
  scaleTo = 0.95,
  duration = 120,
  style,
  pressableStyle,
  ...rest
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue) => {
    Animated.timing(scale, {
      toValue,
      duration,
      // 'useNativeDriver' must be false on web; true on native is fine, but
      // sharing one config keeps the behavior identical everywhere.
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      {/* Fill the animated shell and center children; no native ripple so the
          only press feedback is the scale (subtle, Shopee-style). */}
      <Pressable
        onPressIn={() => animateTo(scaleTo)}
        onPressOut={() => animateTo(1)}
        android_ripple={null}
        style={[{ flex: 1, width: '100%', alignItems: 'center' }, pressableStyle]}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

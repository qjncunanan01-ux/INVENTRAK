import { useEffect, useRef, useState } from 'react';
import { animate, createScope, spring } from 'animejs';

/**
 * AnimatedCounter — counts from 0 to `target` using anime.js spring physics.
 * Gives KPI cards a premium "slot machine" feel when data loads.
 *
 * Props:
 *   target    – final number to display
 *   duration  – animation length (ms)
 *   prefix    – text before number (e.g. "P")
 *   suffix    – text after number (e.g. "%")
 *   decimals  – decimal places to show
 */
export default function AnimatedCounter({
  target,
  duration = 700,
  prefix = '',
  suffix = '',
  decimals = 0,
  style,
}) {
  const [display, setDisplay] = useState(0);
  const root = useRef(null);
  const scope = useRef(null);
  const prevTarget = useRef(0);
  const settleTimer = useRef(null);

  useEffect(() => {
    if (!root.current || target === prevTarget.current) return;
    prevTarget.current = target;

    const obj = { val: 0 };
    scope.current = createScope({ root }).add(() => {
      animate(obj, {
        val: target,
        ease: spring({ bounce: 0.15 }),
        duration,
        onUpdate: () => setDisplay(Number(obj.val.toFixed(decimals))),
        // Snap to the EXACT final value when the animation completes — a
        // spring can land a fraction off, and the KPI card must always show
        // the true number, never 12,339.9.
        onComplete: () => setDisplay(Number(Number(target).toFixed(decimals))),
      });
    });

    // rAF-independent guarantee: browsers throttle requestAnimationFrame in
    // background tabs and jsdom may not tick it at all, which would leave the
    // card stuck at 0. Force the settled value once the animation window has
    // passed no matter what (cleared on unmount / retarget).
    settleTimer.current = setTimeout(() => {
      setDisplay(Number(Number(target).toFixed(decimals)));
    }, duration + 50);

    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
      scope.current?.revert();
    };
  }, [target, duration, decimals]);

  return (
    <span ref={root} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  );
}

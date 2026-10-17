import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { animate, createScope, spring } from 'animejs';

/**
 * AnimatedCounter — counts from 0 to `target` using anime.js spring physics.
 * Gives KPI cards a premium "slot machine" feel when data loads.
 *
 * The count-up is decorative, so `prefers-reduced-motion: reduce` skips it and
 * paints the settled value immediately. That is the same guarantee the
 * settleTimer below already gives, and it matters beyond motion sensitivity:
 * a spring driven by requestAnimationFrame renders a *different* set of digits
 * depending on which frames the browser happened to paint, so a screenshot
 * taken while a card is counting is not reproducible. Honour the preference and
 * the KPI row is identical on every render.
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
  // The same preference index.css checks for the sidebar rows, read here in JS
  // because this animation is anime.js-driven rather than CSS keyframes.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const [display, setDisplay] = useState(0);
  const root = useRef(null);
  const scope = useRef(null);
  const prevTarget = useRef(0);
  const settleTimer = useRef(null);

  useEffect(() => {
    if (!root.current || target === prevTarget.current) return;
    prevTarget.current = target;

    // Snap to the EXACT final value — a spring can land a fraction off, and
    // the KPI card must always show the true number, never 12,339.9.
    const settled = Number(Number(target).toFixed(decimals));

    if (reduceMotion) {
      setDisplay(settled);
      return undefined;
    }

    const obj = { val: 0 };
    scope.current = createScope({ root }).add(() => {
      animate(obj, {
        val: target,
        ease: spring({ bounce: 0.15 }),
        duration,
        onUpdate: () => setDisplay(Number(obj.val.toFixed(decimals))),
        onComplete: () => setDisplay(settled),
      });
    });

    // rAF-independent guarantee: browsers throttle requestAnimationFrame in
    // background tabs and jsdom may not tick it at all, which would leave the
    // card stuck at 0. Force the settled value once the animation window has
    // passed no matter what (cleared on unmount / retarget).
    settleTimer.current = setTimeout(() => {
      setDisplay(settled);
    }, duration + 50);

    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
      scope.current?.revert();
    };
  }, [target, duration, decimals, reduceMotion]);

  return (
    <span ref={root} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}{display.toLocaleString()}{suffix}
    </span>
  );
}

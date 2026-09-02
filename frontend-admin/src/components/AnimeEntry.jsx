import { useEffect, useRef } from 'react';
import { animate, createScope, spring } from 'animejs';

/**
 * AnimeEntry — anime.js-powered entrance animation for admin web components.
 * Replaces basic motion.div with anime.js spring physics and stagger support.
 *
 * Props:
 *   delay     – ms before animation starts
 *   duration  – animation length (ms)
 *   from      – initial state { opacity, y, scale, rotate }
 *   children  – single child element
 */
export default function AnimeEntry({
  children,
  delay = 0,
  duration = 600,
  from = { opacity: 0, y: 30 },
  style,
  className,
}) {
  const root = useRef(null);
  const scope = useRef(null);

  useEffect(() => {
    if (!root.current) return;

    scope.current = createScope({ root }).add((self) => {
      animate(self.ref, {
        opacity: [from.opacity ?? 0, 1],
        translateY: [from.y ?? 30, 0],
        scale: from.scale ? [from.scale, 1] : undefined,
        rotate: from.rotate ? [from.rotate, 0] : undefined,
        ease: spring({ bounce: 0.3 }),
        duration,
        delay,
      });
    });

    return () => scope.current?.revert();
  }, []);

  return (
    <div ref={root} className={className} style={style}>
      {children}
    </div>
  );
}

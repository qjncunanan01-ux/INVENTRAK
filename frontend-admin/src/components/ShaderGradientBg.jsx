import React, { Suspense } from 'react';
import { Box, useMediaQuery } from '@mui/material';

/**
 * Animated 3D gradient background using ShaderGradient (react-three-fiber).
 * Replaces the flat HaikeiBackground with a living, moving gradient.
 * Lazy-loaded via React.lazy so three.js only downloads on the login page.
 *
 * `prefers-reduced-motion: reduce` skips the shader entirely and paints the
 * static gradient instead. Not just pause it: a static WebGL frame still depends
 * on when the scene initialised, so two page loads settle on two different
 * pictures (measured: ~55% of pixels differ between loads) even though each page
 * is frozen. A full-viewport animated background is also the textbook case for
 * the preference, so the no-canvas path is the better one for the user too —
 * no GPU work, no battery drain, and nothing to drift while they read.
 */
const ShaderGradientScene = React.lazy(() =>
  import('@shadergradient/react').then((mod) => ({
    default: function Scene() {
      return (
        <mod.ShaderGradientCanvas
          style={{ position: 'absolute', inset: 0 }}
          pixelDensity={1}
          fov={45}
          lazyLoad
          lazyLoadThreshold={200}
        >
          <mod.ShaderGradient
            cDistance={24}
            cPolarAngle={125}
            animate="on"
            uSpeed={0.3}
            uStrength={4}
            uFrequency={5.5}
            color1="#0f3d12"
            color2="#4CAF50"
            color3="#2d7a35"
            type="plane"
            lightType="3d"
            grain="off"
          />
        </mod.ShaderGradientCanvas>
      );
    },
  })),
);

/**
 * Fallback gradient shown while the WebGL shader loads.
 * Matches the same INVENTRAK green palette.
 */
function FallbackGradient() {
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, #0f3d12 0%, #1a5c20 30%, #2d7a35 60%, #1a5c20 100%)',
      }}
    />
  );
}

export default function ShaderGradientBg() {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        zIndex: 0,
        backgroundColor: '#0f3d12',
      }}
    >
      {reduceMotion ? (
        <FallbackGradient />
      ) : (
        <Suspense fallback={<FallbackGradient />}>
          <ShaderGradientScene />
        </Suspense>
      )}
    </Box>
  );
}

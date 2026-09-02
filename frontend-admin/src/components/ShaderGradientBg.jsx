import React, { Suspense } from 'react';
import { Box } from '@mui/material';

/**
 * Animated 3D gradient background using ShaderGradient (react-three-fiber).
 * Replaces the flat HaikeiBackground with a living, moving gradient.
 * Lazy-loaded via React.lazy so three.js only downloads on the login page.
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
  }))
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
      <Suspense fallback={<FallbackGradient />}>
        <ShaderGradientScene />
      </Suspense>
    </Box>
  );
}

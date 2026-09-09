import React, { Suspense, useState } from 'react';
import { Box } from '@mui/material';

/**
 * Apple-style Liquid Glass card wrapper using liquid-glass-react.
 * Wraps dashboard stat cards with frosted refraction effect.
 * Dynamically imported — three.js/shader libs only load when the dashboard renders.
 *
 * Props:
 * - children: card content
 * - intensity: "low" | "medium" | "high" — controls displacement/blur
 * - color: tint overlay color (default: semi-transparent white)
 */

const LazyLiquidGlass = React.lazy(() =>
  import('liquid-glass-react').then((mod) => ({
    default: mod.default || mod,
  }))
);

function GlassFallback({ children }) {
  return <Box>{children}</Box>;
}

// Detect WebGL support ONCE, synchronously, before the first render (a lazy
// useState initializer, not a post-mount effect). Liquid glass needs a
// WebGL2/WebGL context; browsers/headless environments without one (jsdom,
// low-power devices, some embedded webviews) get a plain card and never even
// start the three.js/liquid-glass import — which also keeps the stat-card
// content from being remounted when the lazy chunk resolves.
function detectWebglSupport() {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function LiquidGlassCard({
  children,
  intensity = 'medium',
  color = 'rgba(255, 255, 255, 0.08)',
}) {
  // Evaluate once per mount: jsdom has no WebGL, so tests render the plain
  // card on the very first paint and the lazy shader path never mounts.
  const [supported] = useState(detectWebglSupport);

  if (!supported) return <Box>{children}</Box>;

  const intensityMap = {
    low: { displacementScale: 40, blurAmount: 0.03, saturation: 110 },
    medium: { displacementScale: 70, blurAmount: 0.06, saturation: 130 },
    high: { displacementScale: 120, blurAmount: 0.1, saturation: 150 },
  };

  const config = intensityMap[intensity] || intensityMap.medium;

  return (
    <Suspense fallback={<GlassFallback>{children}</GlassFallback>}>
      <LazyLiquidGlass
        displacementScale={config.displacementScale}
        blurAmount={config.blurAmount}
        saturation={config.saturation}
        aberrationIntensity={1.5}
        elasticity={0.12}
        cornerRadius={16}
        padding="0"
        style={{
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {children}
        </Box>
      </LazyLiquidGlass>
    </Suspense>
  );
}

import React, { Suspense, useState, useEffect } from 'react';
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

export default function LiquidGlassCard({
  children,
  intensity = 'medium',
  color = 'rgba(255, 255, 255, 0.08)',
}) {
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // Liquid glass uses displacement shaders — fall back gracefully on
    // browsers without WebGL2 or on low-power devices.
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) setSupported(false);
    } catch {
      setSupported(false);
    }
  }, []);

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

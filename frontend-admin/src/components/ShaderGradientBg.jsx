import { Box } from '@mui/material';

// A CSS-only login backdrop keeps the first screen light and avoids requiring
// WebGL for a decorative effect.
export default function ShaderGradientBg() {
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        zIndex: 0,
        background:
          'radial-gradient(ellipse at 20% 20%, rgba(76, 175, 80, 0.38), transparent 42%), radial-gradient(ellipse at 80% 75%, rgba(45, 122, 53, 0.48), transparent 46%), linear-gradient(135deg, #0f3d12, #1a5c20 52%, #0f3d12)',
      }}
      aria-hidden="true"
    />
  );
}

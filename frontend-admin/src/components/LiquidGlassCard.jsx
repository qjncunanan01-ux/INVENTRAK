import React from 'react';
import { Box } from '@mui/material';

/**
 * Modern glass card wrapper. Uses pure CSS backdrop-filter glassmorphism
 * to guarantee pixel-perfect flex/grid alignment across all browsers and screen sizes.
 */
const LiquidGlassCard = React.forwardRef((
  { children, intensity = 'medium', color = 'rgba(255, 255, 255, 0.75)', ...props },
  ref,
) => {
  const blurMap = {
    low: '8px',
    medium: '16px',
    high: '24px',
  };

  const blur = blurMap[intensity] || blurMap.medium;

  return (
    <Box
      ref={ref}
      {...props}
      sx={{
        borderRadius: 3,
        height: '100%',
        width: '100%',
        backgroundColor: color,
        backdropFilter: `blur(${blur})`,
        WebkitBackdropFilter: `blur(${blur})`,
        border: '1px solid rgba(255, 255, 255, 0.3)',
        boxShadow: '0 8px 32px 0 rgba(15, 60, 18, 0.06)',
        overflow: 'hidden',
        position: 'relative',
        ...props.sx,
      }}
    >
      {children}
    </Box>
  );
});

export default LiquidGlassCard;

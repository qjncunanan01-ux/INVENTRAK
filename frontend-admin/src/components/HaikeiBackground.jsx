import { Box } from '@mui/material';
import { motion } from 'framer-motion';

/**
 * Animated wave/blob background inspired by Haikei.app SVG generators.
 * Renders layered animated waves behind the login card.
 */
export default function HaikeiBackground() {
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        zIndex: 0,
        background: 'linear-gradient(135deg, #0f3d12 0%, #1a5c20 30%, #2d7a35 60%, #1a5c20 100%)',
      }}
    >
      {/* Blob 1 - top left */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          rotate: [0, 90, 0],
          x: [0, 20, 0],
          y: [0, -20, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          top: '-10%',
          left: '-10%',
          width: '50vw',
          height: '50vw',
          borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%',
          background: 'radial-gradient(circle, rgba(76, 175, 80, 0.3) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Blob 2 - bottom right */}
      <motion.div
        animate={{
          scale: [1.2, 1, 1.2],
          rotate: [0, -90, 0],
          x: [0, -30, 0],
          y: [0, 30, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          bottom: '-15%',
          right: '-15%',
          width: '60vw',
          height: '60vw',
          borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%',
          background: 'radial-gradient(circle, rgba(56, 142, 60, 0.25) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Wave layer 1 */}
      <motion.svg
        viewBox="0 0 1440 320"
        animate={{ x: [0, 50, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '120%',
          opacity: 0.15,
        }}
      >
        <path
          fill="#4CAF50"
          d="M0,192L48,197.3C96,203,192,213,288,202.7C384,192,480,160,576,165.3C672,171,768,213,864,218.7C960,224,1056,192,1152,165.3C1248,139,1344,117,1392,106.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
        />
      </motion.svg>

      {/* Wave layer 2 */}
      <motion.svg
        viewBox="0 0 1440 320"
        animate={{ x: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '120%',
          opacity: 0.1,
        }}
      >
        <path
          fill="#81C784"
          d="M0,256L48,240C96,224,192,192,288,186.7C384,181,480,203,576,218.7C672,235,768,245,864,229.3C960,213,1056,171,1152,154.7C1248,139,1344,149,1392,154.7L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
        />
      </motion.svg>

      {/* Floating dots */}
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.5, 0.2],
          }}
          transition={{
            duration: 4 + i * 0.5,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.3,
          }}
          style={{
            position: 'absolute',
            top: `${20 + Math.random() * 60}%`,
            left: `${10 + Math.random() * 80}%`,
            width: 4 + Math.random() * 6,
            height: 4 + Math.random() * 6,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.3)',
          }}
        />
      ))}
    </Box>
  );
}

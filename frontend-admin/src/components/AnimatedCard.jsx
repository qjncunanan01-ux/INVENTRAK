import { Paper } from '@mui/material';
import { motion } from 'framer-motion';

/**
 * Animated card component inspired by Motion Primitives.
 * Adds smooth hover/tap animations to any card content.
 */
export default function AnimatedCard({ children, onClick, delay = 0, ...props }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      whileHover={{ 
        y: -4, 
        boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
        transition: { duration: 0.2 }
      }}
      whileTap={{ scale: 0.98 }}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <Paper
        {...props}
        sx={{
          borderRadius: 3,
          overflow: 'hidden',
          transition: 'box-shadow 0.3s ease',
          ...props.sx,
        }}
      >
        {children}
      </Paper>
    </motion.div>
  );
}

/**
 * Animated list item that fades in sequentially.
 */
export function AnimatedListItem({ children, index = 0, ...props }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Animated counter that counts up from 0 to target value.
 */
export function AnimatedCounter({ value, duration = 1.5, prefix = '', suffix = '' }) {
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </motion.span>
    </motion.span>
  );
}

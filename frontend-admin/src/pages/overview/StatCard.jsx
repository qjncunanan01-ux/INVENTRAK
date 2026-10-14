import { Box, Paper, Tooltip, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import AnimatedCounter from '../../components/AnimatedCounter';
import LiquidGlassCard from '../../components/LiquidGlassCard';
import { MONEY_MASK } from '../../components/Money';

// Reusable stat card with Motion Primitives-style animation. Extracted from
// DashboardPage: it is purely presentational (panel + flags in, click out).
export default function StatCard({ panel, loading, onClick, index = 0, masked = false, maskLabel = 'Executive Access Only' }) {
  // `masked` renders the placeholder for roles without financial or executive
  // visibility.
  const display = masked ? MONEY_MASK : panel.value;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: 'easeOut' }}
      whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.15)' }}
      whileTap={{ scale: 0.98 }}
      style={{ height: '100%' }}
    >
      <Tooltip title={masked ? `Restricted: ${maskLabel}` : 'Click to view detailed item list'} arrow placement="top">
        <LiquidGlassCard intensity="low" color="rgba(255, 255, 255, 0.05)">
          <Paper
            onClick={() => !masked && onClick(panel)}
            onKeyDown={(e) => { if (!masked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(panel); } }}
            tabIndex={masked ? -1 : 0}
            role="button"
            aria-label={`${panel.label}: ${loading ? 'loading' : display}.`}
            sx={{
              p: 2.5,
              height: '100%',
              backgroundColor: masked ? 'rgba(245, 245, 245, 0.85)' : 'rgba(255, 255, 255, 0.85)',
              borderRadius: 3,
              borderLeft: `4px solid ${masked ? '#9e9e9e' : panel.color}`,
              cursor: masked ? 'default' : 'pointer',
              transition: 'box-shadow 0.2s ease-in-out',
              backdropFilter: 'blur(8px)',
              '&:focus-visible': {
                outline: '2px solid #1f640e',
                outlineOffset: '2px',
              },
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5, fontSize: '0.72rem' }}>
                {panel.label}
              </Typography>
              <motion.div
                whileHover={{ rotate: 10, scale: 1.2 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Box sx={{ color: 'text.secondary', opacity: 0.5 }} aria-hidden="true">{panel.icon}</Box>
              </motion.div>
            </Box>
            <Typography variant="h5" color={masked ? 'text.secondary' : 'text.primary'} sx={{ fontWeight: 700 }}>
              {loading ? '…' : masked ? (
                <Box component="span" sx={{ letterSpacing: '0.15em', opacity: 0.65 }}>{panel.prefix ? `${panel.prefix} ***,***` : '***'}</Box>
              ) : (
                <AnimatedCounter
                  target={panel.numericValue ?? 0}
                  prefix={panel.prefix || ''}
                  suffix={panel.suffix || ''}
                  duration={700}
                />
              )}
            </Typography>
            <Typography variant="caption" color={masked ? 'text.secondary' : 'primary'} sx={{ display: 'inline-block', mt: 0.5, fontWeight: 500, opacity: 0.85 }}>
              {masked ? `🔒 ${maskLabel || 'Restricted'}` : 'Click to inspect →'}
            </Typography>
          </Paper>
        </LiquidGlassCard>
      </Tooltip>
    </motion.div>
  );
}

import { Box, Typography } from '@mui/material';
import RangeFilter from '../../components/RangeFilter';

// Small presentational primitives shared by the dashboard container and its
// chart sections. Extracted from DashboardPage so the chart components can use
// them without importing the page (which would be a cycle).

// A section heading with an optional per-section Days/Weeks/Months/Quarterly/
// Annually filter on the right.
export function SectionLabel({ children, rangeValue, onRangeChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5, mt: 3.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.2, fontSize: '0.78rem' }}>
        {children}
      </Typography>
      {onRangeChange && (
        <RangeFilter value={rangeValue} onChange={onRangeChange} compact />
      )}
    </Box>
  );
}

export function NoData({ msg }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <Typography color="text.secondary" variant="body2">{msg || 'No data available yet'}</Typography>
    </Box>
  );
}

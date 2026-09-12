import { Box, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { RANGE_PRESETS } from '../dateRange';

// Shared Days / Weeks / Months / Quarterly / Annually filter. Every analytical
// screen renders this same control so the range vocabulary is identical on the
// dashboard, reports and the optimization algorithm page.
export default function RangeFilter({ value, onChange, label = 'Range', compact = false, sx }) {
  const active = RANGE_PRESETS.find((p) => p.id === value);

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={sx}
      role="group"
      aria-label={`${label} filter`}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ fontWeight: 700, letterSpacing: 1.1, lineHeight: 1 }}
      >
        {label}
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value}
        onChange={(_, next) => { if (next) onChange(next); }}
        aria-label={`${label} presets`}
        sx={{
          '& .MuiToggleButton-root': {
            px: compact ? 1.1 : 1.6,
            py: 0.4,
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.78rem',
            lineHeight: 1.4,
          },
        }}
      >
        {RANGE_PRESETS.map((preset) => (
          <ToggleButton key={preset.id} value={preset.id} aria-label={`${preset.caption} (${preset.label})`}>
            <Tooltip title={preset.caption} arrow>
              <Box component="span">{preset.label}</Box>
            </Tooltip>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {!compact && active ? (
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          {active.caption}
        </Typography>
      ) : null}
    </Stack>
  );
}

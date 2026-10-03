import { Box, Typography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { colors } from '../theme';

/**
 * "Why?" evidence toggle — the panel-facing counterpart to FormulaBanner.
 *
 * FormulaBanner shows the RULE ("price = cost / (1 - target)"). This shows the
 * NUMBERS that one specific figure was computed from. Together they let the
 * admin console defend an algorithm without anyone reading source: the rule is
 * on screen, the inputs are on screen, and the output is right there.
 *
 * This mirrors the existing ABC/FSN "Why?" badge on the Optimization page —
 * the products page just had no equivalent, which is why the cost and repricing
 * figures were the hardest ones to show.
 *
 * @param {object} props
 * @param {string} props.label    Tooltip trigger text, e.g. "Why?".
 * @param {string[]} props.lines  One line per input, e.g. "cost = ₱850".
 * @param {string} [props.result] Optional concluding line ("= ₱1,215").
 * @param {string} [props.align]  'left' | 'right' — right for numeric columns.
 */
export default function WhyCell({ label = 'Why?', lines = [], result, align = 'left' }) {
  if (!lines.length) return null;
  return (
    <Box
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: align === 'right' ? 'flex-end' : 'flex-start',
        gap: 0.25,
      }}
    >
      <Typography
        component="span"
        variant="caption"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          cursor: 'help',
          color: 'text.secondary',
          borderBottom: '1px dotted',
          borderColor: 'divider',
          '&:hover': { color: colors.brandPrimary },
        }}
      >
        <HelpOutlineIcon fontSize="inherit" aria-hidden />
        {label}
      </Typography>
      <Box
        component="ul"
        sx={{
          m: 0,
          pl: 1.5,
          listStyle: 'none',
          fontSize: '0.68rem',
          color: 'text.secondary',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {lines.map(line => (
          <li key={line}>{line}</li>
        ))}
        {result && (
          <li style={{ color: colors.brandPrimary, fontWeight: 700 }}>{result}</li>
        )}
      </Box>
    </Box>
  );
}
import { Box, Typography } from '@mui/material';
import FunctionsOutlined from '@mui/icons-material/FunctionsOutlined';
import { colors } from '../theme';

/**
 * Formula banner — renders the exact math an algorithm page's numbers come
 * from, so the panel/demo audience can see the formula next to the results.
 *
 * One line per formula, plus an optional one-sentence "in words" explainer.
 * Keep the formula text in sync with the backend modules it mirrors:
 *   ABC / FSN / EOQ-ROP → backend/src/app.js + backend/src/fsn.js
 *   Critical level      → backend/src/critical-level.js
 *
 * @param {object} props
 * @param {string} props.title    Heading, e.g. "ABC classification formula".
 * @param {string[]} props.items  One string per formula line.
 * @param {string} [props.note]   Optional plain-language caption under the math.
 * @param {boolean} [props.dense] Tighter padding for embedding in cards.
 */
export default function FormulaBanner({ title, items, note, dense = false }) {
  return (
    <Box
      role="note"
      aria-label={`${title || 'Formula'} — the math behind these numbers`}
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
        p: dense ? 1.25 : 1.75,
        borderRadius: 2,
        border: '1px dashed rgba(31, 100, 14, 0.35)',
        backgroundColor: 'rgba(31, 100, 14, 0.05)',
      }}
    >
      <FunctionsOutlined sx={{ color: colors.brandPrimary, fontSize: 20, mt: '2px' }} aria-hidden />
      <Box>
        <Typography
          variant="overline"
          sx={{ display: 'block', lineHeight: 1.4, color: colors.brandPrimary, fontWeight: 700 }}
        >
          {title || 'Formula'}
        </Typography>
        {items.map((line) => (
          <Typography
            key={line}
            variant="body2"
            component="code"
            sx={{
              display: 'block',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '0.78rem',
              color: colors.textPrimary,
              whiteSpace: 'pre-wrap',
            }}
          >
            {line}
          </Typography>
        ))}
        {note ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: colors.textSecondary }}>
            {note}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

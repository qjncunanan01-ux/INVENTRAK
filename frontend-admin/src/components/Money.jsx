import { Tooltip, Typography } from '@mui/material';
import { getCurrentUser } from '../api';
import { canSeeMoney } from '../roles';

// Role-gated money display. Owner / Super Admin / Admin see the amount;
// Inventory Staff see a masked placeholder instead — the role spec forbids
// them from viewing sales, prices or revenue. Use this anywhere a peso value
// is rendered so the gate can never be forgotten at one call site.
export const MONEY_MASK = '••••';

export function formatMoney(value, prefix = 'P') {
  return `${prefix}${(Number(value) || 0).toLocaleString()}`;
}

export default function Money({ value, prefix = 'P', sx, component = 'span', ...rest }) {
  const role = getCurrentUser()?.role || 'admin';

  if (!canSeeMoney(role)) {
    return (
      <Tooltip title="Hidden for your role" arrow>
        <Typography
          component={component}
          aria-label="Amount hidden for your role"
          sx={{ letterSpacing: '0.15em', ...sx }}
          {...rest}
        >
          {MONEY_MASK}
        </Typography>
      </Tooltip>
    );
  }

  return (
    <Typography component={component} sx={sx} {...rest}>
      {formatMoney(value, prefix)}
    </Typography>
  );
}

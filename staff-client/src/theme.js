// Brand palette — the SAME colors as the customer app and the web admin
// (one brand across the whole system): green primary/secondary, cream
// background, dark-green text. This app is staff-exclusive, so the palette
// carries no separate accent — it is INVENTRAK, full stop. The extra
// semantic keys (pending/approved/rejected) drive the My Requests badges.
export const colors = {
  brandPrimary: '#4e7d15',
  brandSecondary: '#a0c938',
  background: '#eef7e1',
  surface: '#ffffff',
  border: 'rgba(0, 0, 0, 0.14)',
  textPrimary: '#1f3514',
  textSecondary: '#5d7b3a',
  error: '#d32f2f',
  info: '#1565c0',
  success: '#2e7d32',
  warning: '#f9a825',
  pending: '#b8860b',
  approved: '#2e7d32',
  rejected: '#d32f2f',
};

// DARK variant — identical to the customer app's dark palette so the two
// phone apps look like siblings on the same device.
export const darkColors = {
  brandPrimary: '#8bc34a',
  brandSecondary: '#a8d22b',
  background: '#10150c',
  surface: '#1a2113',
  border: 'rgba(255, 255, 255, 0.28)',
  textPrimary: '#eef7e1',
  textSecondary: '#9db88a',
  error: '#ef5350',
  info: '#64b5f6',
  success: '#66bb6a',
  warning: '#ffb74d',
  pending: '#e6c34a',
  approved: '#66bb6a',
  rejected: '#ef5350',
};

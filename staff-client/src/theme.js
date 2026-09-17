// Brand palette — same greens as the customer app (one brand, two apps) but
// with an amber WORK-SECONDARY accent so a staff device reads as a tool, not
// a shop. Screens consume the active palette through useThemeColors().
export const colors = {
  brandPrimary: '#4e7d15',
  brandSecondary: '#a0c938',
  workAccent: '#b8860b', // dark goldenrod — scan/count highlights, tab tint
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

export const darkColors = {
  brandPrimary: '#8bc34a',
  brandSecondary: '#a8d22b',
  workAccent: '#e6c34a',
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

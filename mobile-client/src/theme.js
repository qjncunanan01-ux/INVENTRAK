// Brand palette — LIGHT mode (the default). Screens consume the ACTIVE
// palette through useThemeColors() from './theme-context', so the app can
// flip to `darkColors` below when the user toggles dark mode on the Account
// screen. Keep this export for code that only ever wants the light look.
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
};

// DARK variant of the same palette (green-tinted, matches the brand):
// darker surfaces with the same accent greens, so every screen stays on-brand
// while becoming night-readable.
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
};

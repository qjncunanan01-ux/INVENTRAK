// OFFICIAL SYLVER PALETTE — the single source of truth for colour in the
// customer app. Values are sampled from the supplied Sylver logo artwork (leaf
// green, coffee-bean brown) and the cream page the mark sits on, so the phone
// app, the staff app and the web console are visibly one product family.
//
// Screen code never writes a hex of its own: it reads the ACTIVE palette
// through useThemeColors() from './theme-context', which flips between
// `colors` (light) and `darkColors` below when the user toggles dark mode on
// the Account screen. Keep this export for code that only ever wants the light
// look.
//
// CONTRAST NOTE: `brandPrimary` is used in this app as a SURFACE that carries
// white text (headers, buttons) and as icon ink on white, so it is the DARK
// shade of the brand green (#47752A). The raw logo lime (#82BD35) is 2.0:1 on
// white and unreadable that way; it lives in `brandAccent`/`brandSecondary` for
// highlights, prices and progress fills instead.
export const brand = {
  green: '#82BD35',
  greenDark: '#47752A',
  brown: '#B47C3B',
  brownDark: '#805325',
  background: '#F8FAF5',
  surface: '#FFFFFF',
  softAccent: '#EEF5E5',
  textPrimary: '#263326',
  textSecondary: '#647064',
  border: '#DFE7D8',
  error: '#C62828',
  warning: '#B26A00',
  success: '#2E7D32',
  info: '#1565C0',
};

// The partner business INVENTRAK was built for — shown on the login screen and
// the home header. INVENTRAK stays the SOFTWARE name; Sylver is the company.
export const company = {
  name: 'Sylver Restaurant and Coffee Supplies',
  brand: 'SYLVER',
  tagline: 'YOUR PARTNER IN EVERY CREATION',
  software: 'INVENTRAK',
  // Supplied artwork is opaque white; it is only ever placed on a white/cream
  // surface, never recoloured or cropped.
  logo: require('../assets/sylver-logo.png'),
  symbol: require('../assets/sylver-symbol.png'),
};

export const colors = {
  brandPrimary: brand.greenDark,
  brandSecondary: brand.green,
  brandAccent: brand.softAccent,
  brandBrown: brand.brown,
  brandBrownDark: brand.brownDark,
  background: brand.background,
  surface: brand.surface,
  border: brand.border,
  textPrimary: brand.textPrimary,
  textSecondary: brand.textSecondary,
  error: brand.error,
  info: brand.info,
  success: brand.success,
  warning: brand.warning,
};

// DARK variant of the same palette (green-tinted, matches the brand):
// darker surfaces with the same accent greens, so every screen stays on-brand
// while becoming night-readable.
export const darkColors = {
  brandPrimary: brand.green,
  brandSecondary: '#A5D45C',
  brandAccent: '#22301A',
  brandBrown: '#D9A468',
  brandBrownDark: '#B47C3B',
  background: '#10150C',
  surface: '#1A2113',
  border: 'rgba(255, 255, 255, 0.28)',
  textPrimary: '#EEF5E5',
  textSecondary: '#9DB88A',
  error: '#EF5350',
  info: '#64B5F6',
  success: '#66BB6A',
  warning: '#FFB74D',
};

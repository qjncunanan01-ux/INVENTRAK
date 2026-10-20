// OFFICIAL SYLVER PALETTE — the SAME palette as the customer app and the web
// admin (one brand across the whole system): Sylver leaf green, coffee-bean
// brown, cream background, dark green-gray text. This app is staff-exclusive,
// so the palette carries no separate accent — it is INVENTRAK, full stop. The
// extra semantic keys (pending/approved/rejected) drive the My Requests badges.
//
// CONTRAST NOTE: `brandPrimary` carries white text (headers, buttons) and is
// icon ink on white, so it is the DARK shade of the brand green (#47752A). The
// raw logo lime (#82BD35) is 2.0:1 on white — it lives in `brandSecondary`
// (highlights, progress fills, active ticks) where no text sits on it.
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

// The partner business INVENTRAK was built for — shown on the login screen.
// INVENTRAK stays the SOFTWARE name; Sylver is the company.
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
  pending: brand.warning,
  approved: brand.success,
  rejected: brand.error,
};

// DARK variant — identical to the customer app's dark palette so the two phone
// apps look like siblings on the same device.
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
  pending: '#E6C34A',
  approved: '#66BB6A',
  rejected: '#EF5350',
};

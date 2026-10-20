import { createTheme } from '@mui/material/styles';

// OFFICIAL SYLVER PALETTE — the single source of truth for colour in the web
// admin. Values are sampled from the supplied Sylver logo artwork: the leaf
// green of the symbol, the coffee-bean brown, and the cream page the mark sits
// on. Everything else reads these tokens (directly, or through `colors` below)
// instead of inventing a hex, so a palette change is one edit, not a hunt.
//
// CONTRAST PAIRS (WCAG AA normal text = 4.5:1; ratios are for the pairs used):
//   textPrimary on background / surface / softAccent      ~12:1
//   textPrimary on green (lime)                           ~7.6:1
//   #ffffff on greenDark / brownDark                     ~5.6:1 / ~6.1:1
// The brand green is a LIGHT colour: white text on it is 2.0:1 and unreadable,
// so anything that needs white text uses greenDark. That is why `brand` keeps
// both, and why primary buttons carry dark text rather than white.
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

// The partner business INVENTRAK was built for. Kept beside the palette because
// both are branding and both are rendered by the login page and the sidebar.
// INVENTRAK stays the SOFTWARE name — the company is Sylver, the product is not.
export const company = {
  name: 'Sylver Restaurant and Coffee Supplies',
  brand: 'SYLVER',
  tagline: 'YOUR PARTNER IN EVERY CREATION',
  software: 'INVENTRAK',
  // Public assets (frontend-admin/public/). The supplied artwork is opaque
  // white, so it is always placed on a white/cream surface — never recoloured
  // or cropped, which would damage the official mark.
  logo: '/sylver-logo.png',
  symbol: '/sylver-symbol.png',
};

// Brand palette — LIGHT mode (default).
//
// FILL vs TEXT is the distinction that keeps this readable: `brandPrimary` is
// the logo lime and is for SURFACES (button fills, chart bars, progress dots).
// `brandPrimaryDark` is the same brand family at a value that works as INK on
// white (icons, links, outline borders, small labels) — the lime itself is
// 2.0:1 on white and unreadable as text.
export const lightColors = {
  brandPrimary: brand.green,
  brandPrimaryDark: brand.greenDark,
  brandSecondary: brand.brown,
  brandSecondaryDark: brand.brownDark,
  brandAccent: brand.softAccent,
  background: brand.background,
  surface: brand.surface,
  surfaceAlt: brand.softAccent,
  textPrimary: brand.textPrimary,
  textSecondary: brand.textSecondary,
  border: brand.border,
  error: brand.error,
  info: brand.info,
  success: brand.success,
  warning: brand.warning,
};

// Mutable palette: pages read `colors.surfaceAlt` etc. in their `sx` props at
// render time. Always the light palette — dark mode was removed.
export const colors = { ...lightColors };

// The deep brand green the sidebar + login header use: white/cream text on the
// lime would be unreadable, so the chrome takes the DARK green from the palette.
export const brandSidebar = brand.greenDark;

export function createAppTheme() {
  return createTheme({
    palette: {
      mode: 'light',
      // Primary = Sylver green with DARK text (white on lime is 2.0:1).
      // Secondary = Sylver brown (dark shade) with white text.
      primary: { main: colors.brandPrimary, dark: colors.brandPrimaryDark, contrastText: colors.textPrimary },
      secondary: { main: colors.brandSecondaryDark, contrastText: '#ffffff' },
      background: { default: colors.background, paper: colors.surface },
      text: { primary: colors.textPrimary, secondary: colors.textSecondary },
      divider: 'rgba(38, 51, 38, 0.12)',
    },
    shape: { borderRadius: 16 },
    typography: {
      fontFamily: 'Inter, sans-serif',
      button: { textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Vercel guideline: touch-action manipulation prevents double-tap zoom delay
          'button, a, [role="button"]': {
            touchAction: 'manipulation',
          },
          // Vercel guideline: font-variant-numeric tabular-nums for number columns
          'td, th, .tabular-nums': {
            fontVariantNumeric: 'tabular-nums',
          },
          // Vercel guideline: scroll-margin-top so sticky headers don't cover anchors
          'h1, h2, h3, h4, h5, h6': {
            scrollMarginTop: '80px',
          },
          // Vercel guideline: visible focus ring on interactive elements
          'button:focus-visible, a:focus-visible, [role="button"]:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible': {
            outline: `2px solid ${colors.brandPrimaryDark}`,
            outlineOffset: '2px',
          },
          // Taste Skill: tactile feedback on active buttons
          'button:active': {
            transform: 'scale(0.98)',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: colors.surface,
            boxShadow: '0 20px 60px rgba(38, 51, 38, 0.08)',
            border: `1px solid ${colors.border}`,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
          containedPrimary: {
            backgroundColor: colors.brandPrimary,
            // Dark on lime — see the contrast note at the top of this file.
            color: colors.textPrimary,
            '&:hover': {
              backgroundColor: '#72A82D',
            },
          },
          containedSecondary: {
            backgroundColor: colors.brandSecondaryDark,
            color: '#ffffff',
            '&:hover': {
              backgroundColor: '#673F1B',
            },
          },
          outlinedPrimary: {
            borderColor: 'rgba(130, 189, 53, 0.55)',
            // The dark shade, because lime text on a white card fails contrast.
            color: colors.brandPrimaryDark,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            backgroundColor: colors.surfaceAlt,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            backgroundColor: colors.surfaceAlt,
            '& input': { color: colors.textPrimary },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${colors.border}`,
            color: colors.textPrimary,
          },
          head: {
            backgroundColor: colors.brandAccent,
            color: colors.textPrimary,
            fontWeight: 700,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: colors.surface,
          },
        },
      },
    },
  });
}

// NOTE: no default export — App.js builds the light theme via createAppTheme().

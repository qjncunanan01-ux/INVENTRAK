import { createTheme } from '@mui/material/styles';

// Brand palette — LIGHT mode (default).
export const lightColors = {
  brandPrimary: '#1f640e',
  brandSecondary: '#a8d22b',
  brandAccent: '#e9ffd5',
  background: '#eef7e1',
  surface: '#ffffff',
  surfaceAlt: '#f8fff6',
  textPrimary: '#112a07',
  textSecondary: '#4f6c35',
  error: '#d32f2f',
  info: '#1565c0',
  success: '#2e7d32',
  warning: '#f9a825',
};

// DARK variant of the same palette (green-tinted, matches the brand).
export const darkColors = {
  brandPrimary: '#8bc34a',
  brandSecondary: '#a8d22b',
  brandAccent: '#24331a',
  background: '#0f1409',
  surface: '#1a2212',
  surfaceAlt: '#202b16',
  textPrimary: '#eaf5dd',
  textSecondary: '#9db88a',
  error: '#ef5350',
  info: '#64b5f6',
  success: '#66bb6a',
  warning: '#ffb74d',
};

// Mutable palette: pages read `colors.surfaceAlt` etc. in their `sx` props at
// render time, so applyPalette(mode) swapping the values + the mode state
// change re-rendering the tree flips EVERY page without editing any of them.
export const colors = { ...lightColors };

export function applyPalette(mode) {
  const src = mode === 'dark' ? darkColors : lightColors;
  Object.keys(src).forEach((k) => {
    colors[k] = src[k];
  });
}

// The deep brand green the sidebar + login header keep in BOTH modes (it is
// already dark, white text stays readable). Independent of the palette swap.
export const brandSidebar = '#1f640e';

export function createAppTheme(mode = 'light') {
  applyPalette(mode);
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: colors.brandPrimary, contrastText: '#ffffff' },
      secondary: { main: colors.brandSecondary, contrastText: isDark ? '#0f1409' : '#112a07' },
      background: { default: colors.background, paper: colors.surface },
      text: { primary: colors.textPrimary, secondary: colors.textSecondary },
      divider: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15, 60, 18, 0.12)',
    },
    shape: { borderRadius: 16 },
    typography: {
      fontFamily: 'Inter, sans-serif',
      button: { textTransform: 'none' },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: colors.surface,
            boxShadow: isDark
              ? '0 20px 60px rgba(0, 0, 0, 0.5)'
              : '0 20px 60px rgba(15, 60, 18, 0.08)',
            border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15, 60, 18, 0.08)',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
          containedPrimary: {
            backgroundColor: isDark ? '#7db33a' : colors.brandPrimary,
            color: '#ffffff',
            '&:hover': {
              backgroundColor: isDark ? '#6ea132' : '#19570c',
            },
          },
          containedSecondary: {
            backgroundColor: colors.brandSecondary,
            color: isDark ? '#0f1409' : colors.textPrimary,
            '&:hover': {
              backgroundColor: '#94c026',
            },
          },
          outlinedPrimary: {
            borderColor: 'rgba(31, 100, 14, 0.2)',
            color: colors.brandPrimary,
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
            borderBottom: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(15, 60, 18, 0.12)',
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

// NOTE: no default export — index.js renders <ThemeModeProvider><App/></ThemeModeProvider>
// and App.js builds the theme via createAppTheme(mode) so it reacts to mode changes.

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

// Mutable palette: pages read `colors.surfaceAlt` etc. in their `sx` props at
// render time. Always the light palette — dark mode was removed.
export const colors = { ...lightColors };

// The deep brand green the sidebar + login header keep in BOTH modes (it is
// already dark, white text stays readable). Independent of the palette swap.
export const brandSidebar = '#1f640e';

export function createAppTheme() {
  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: colors.brandPrimary, contrastText: '#ffffff' },
      secondary: { main: colors.brandSecondary, contrastText: '#112a07' },
      background: { default: colors.background, paper: colors.surface },
      text: { primary: colors.textPrimary, secondary: colors.textSecondary },
      divider: 'rgba(15, 60, 18, 0.12)',
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
            boxShadow: '0 20px 60px rgba(15, 60, 18, 0.08)',
            border: '1px solid rgba(15, 60, 18, 0.08)',
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
            color: '#ffffff',
            '&:hover': {
              backgroundColor: '#19570c',
            },
          },
          containedSecondary: {
            backgroundColor: colors.brandSecondary,
            color: colors.textPrimary,
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
            borderBottom: '1px solid rgba(15, 60, 18, 0.12)',
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

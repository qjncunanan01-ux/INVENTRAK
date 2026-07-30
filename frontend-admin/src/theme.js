import { createTheme } from '@mui/material/styles';

export const colors = {
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

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: colors.brandPrimary, contrastText: '#ffffff' },
    secondary: { main: colors.brandSecondary, contrastText: '#112a07' },
    background: { default: colors.background, paper: colors.surface },
    text: { primary: colors.textPrimary, secondary: colors.textSecondary },
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
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(15, 60, 18, 0.12)',
        },
        head: {
          backgroundColor: colors.brandAccent,
          color: colors.textPrimary,
          fontWeight: 700,
        },
      },
    },
  },
});

export default theme;

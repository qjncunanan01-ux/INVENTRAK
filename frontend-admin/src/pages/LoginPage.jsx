import { Alert, Box, Button, Container, InputAdornment, IconButton, Paper, Snackbar, Stack, TextField, Typography } from '@mui/material';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useEffect, useState } from 'react';
import { API_BASE_URL, mfaVerify, setToken } from '../api';
import { brandSidebar, colors } from '../theme';

// Demo accounts the quick-fill buttons populate. Kept in one place so the
// two buttons and the hints below can never drift apart.
const DEMO_ACCOUNTS = {
  owner: { username: 'admin', password: 'admin123', label: 'Owner', note: 'full access' },
  staff: { username: 'staff', password: 'staff123', label: 'Staff', note: 'requests & scanning' },
};

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  // Admin MFA second factor: after a successful password login the backend
  // returns mfa_required + a short-lived challenge token instead of a session.
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  // Live countdown while the account is locked out (429 with retryAfterSeconds).
  useEffect(() => {
    if (lockoutLeft <= 0) return undefined;
    const t = setInterval(() => setLockoutLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockoutLeft]);

  // One tap fills the demo account so presenters never type credentials on
  // stage (and the form stays clean for real accounts).
  const fillDemo = (role) => {
    const account = DEMO_ACCOUNTS[role];
    if (!account) return;
    setUsername(account.username);
    setPassword(account.password);
    setError('');
  };

  const handleSubmit = async () => {
    if (lockoutLeft > 0) return;
    if (!username || !password) {
      setError('Please enter username and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        // Brute-force lockout: surface the wait and disable the button until
        // the backend says the account unlocks (retryAfterSeconds).
        if (res.status === 429 && data.retryAfterSeconds) {
          setLockoutLeft(data.retryAfterSeconds);
          setError(
            `Too many failed login attempts. Try again in ${data.retryAfterSeconds}s.`
          );
          return;
        }
        setError(data.error || 'Login failed');
        return;
      }
      // Admin MFA: password accepted, now ask for the authenticator code.
      if (data.mfa_required) {
        setMfaToken(data.mfaToken);
        setMfaCode('');
        setError('');
        setLoading(false);
        return;
      }
      // Staff-or-admin sign-in: customer-app accounts can never open the
      // dashboard. Staff see a read/request-only subset; admins see all the
      // store's controls. Register (customer app) hardcodes role 'customer',
      // so this gate keeps the store's controls out of customer accounts.
      if (!data.user || !['admin', 'staff'].includes(data.user.role)) {
        setError('This account does not have staff or admin access. Sign in with a staff or admin account.');
        return;
      }
      setToken(data.token);
      setSnackbar({ open: true, message: 'Login successful!', severity: 'success' });
      setTimeout(() => {
        onLogin(data.user);
        // Force a clean page reload so the dashboard renders from scratch
        // instead of inheriting any stale login-page state.
        window.location.reload();
      }, 500);
    } catch (err) {
      setError('Network error — could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Second factor: exchange the challenge token + authenticator code for a
  // real session. The challenge expires in 10 minutes.
  const handleMfaSubmit = async () => {
    if (!mfaCode) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await mfaVerify({ mfaToken, code: mfaCode });
      if (!data.user || !['admin', 'staff'].includes(data.user.role)) {
        setError('This account does not have staff or admin access.');
        return;
      }
      setToken(data.token);
      setMfaToken(null);
      setSnackbar({ open: true, message: 'MFA verified — login successful!', severity: 'success' });
      setTimeout(() => {
        onLogin(data.user);
        window.location.reload();
      }, 500);
    } catch (err) {
      setError(err.status === 429 ? 'Too many attempts. Wait a moment and try again.' : (err.message || 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') (mfaToken ? handleMfaSubmit() : handleSubmit());
  };

  return (
    <Container
      maxWidth="sm"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
        py: 8,
      }}
    >
      <Paper sx={{ width: '100%', p: { xs: 3, md: 5 }, borderRadius: 4, boxShadow: '0 30px 90px rgba(15, 60, 18, 0.12)' }}>
        <Box sx={{ mb: 3, p: 3, borderRadius: 3, backgroundColor: brandSidebar, color: '#fff' }}>
          <Typography variant="h5" component="div" gutterBottom>
            INVENTRAK Admin
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            Secure inventory controls and analytics.
          </Typography>
        </Box>

        <Typography variant="subtitle1" sx={{ mb: 2, color: colors.textSecondary }}>
          Sign in with your staff or admin credentials to manage products, inventory, and orders.
        </Typography>

        {/* Demo quick-fill: one tap populates the account, then press Login. */}
        <Stack direction="row" spacing={1.5} sx={{ mb: 1 }}>
          <Button
            fullWidth
            variant="contained"
            onClick={() => fillDemo('owner')}
            startIcon={<AdminPanelSettingsOutlined />}
            disabled={loading}
            aria-label="Fill owner demo account (admin / admin123)"
            sx={{
              py: 1.25,
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 0.25,
              backgroundColor: colors.brandPrimary,
              '&:hover': { backgroundColor: '#19570c' },
              textTransform: 'none',
            }}
          >
            <Box sx={{ fontWeight: 800, letterSpacing: 0.5 }}>Owner</Box>
            <Box sx={{ fontSize: '0.7rem', opacity: 0.92, lineHeight: 1.2 }}>
              admin / admin123 · full access
            </Box>
          </Button>
          <Button
            fullWidth
            variant="contained"
            onClick={() => fillDemo('staff')}
            startIcon={<BadgeOutlined />}
            disabled={loading}
            aria-label="Fill staff demo account (staff / staff123)"
            sx={{
              py: 1.25,
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 0.25,
              backgroundColor: '#e66a0d',
              '&:hover': { backgroundColor: '#cf5c09' },
              textTransform: 'none',
            }}
          >
            <Box sx={{ fontWeight: 800, letterSpacing: 0.5 }}>Staff</Box>
            <Box sx={{ fontSize: '0.7rem', opacity: 0.92, lineHeight: 1.2 }}>
              staff / staff123 · requests &amp; scanning
            </Box>
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mb: 3, color: colors.textSecondary }}>
          One tap fills the demo account — then press Login. The role badge after sign-in shows which account you're on.
        </Typography>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {mfaToken ? (
          <>
            <Typography variant="body2" sx={{ mb: 2, color: colors.textSecondary }}>
              Two-factor authentication is enabled for this account. Enter the 6-digit code from your authenticator app (Google Authenticator, Authy, etc.).
            </Typography>
            <TextField
              fullWidth
              variant="outlined"
              label="Authenticator code"
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              inputProps={{ maxLength: 6, inputMode: 'numeric' }}
              sx={{ mb: 3 }}
              disabled={loading}
            />
            <Button fullWidth variant="contained" color="secondary" onClick={handleMfaSubmit} disabled={loading} size="large">
              {loading ? 'Verifying...' : 'Verify code'}
            </Button>
            <Button fullWidth variant="outlined" onClick={() => setMfaToken(null)} sx={{ mt: 1 }} disabled={loading}>
              ← Back to login
            </Button>
          </>
        ) : (
          <>
            <TextField
              fullWidth
              variant="outlined"
              label="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="username"
              sx={{ mb: 2 }}
              disabled={loading}
            />
            <TextField
              fullWidth
              variant="outlined"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              onKeyUp={e => setCapsLock(Boolean(e.getModifierState && e.getModifierState('CapsLock')))}
              autoComplete="current-password"
              sx={{ mb: 1 }}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((s) => !s)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            {capsLock && (
              <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'warning.main' }}>
                Caps Lock is on — your password will not match.
              </Typography>
            )}
            <Button fullWidth variant="contained" color="secondary" onClick={handleSubmit} disabled={loading || lockoutLeft > 0} size="large" sx={{ mt: 2 }}>
              {loading
                ? 'Signing in...'
                : lockoutLeft > 0
                  ? `Locked — try again in ${lockoutLeft}s`
                  : 'Login'}
            </Button>
          </>
        )}
      </Paper>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Container>
  );
}

import { Alert, Box, Button, Container, InputAdornment, IconButton, Paper, Snackbar, TextField, Typography } from '@mui/material';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { API_BASE_URL, mfaVerify, setToken } from '../api';
import ShaderGradientBg from '../components/ShaderGradientBg';
import { ADMIN_TIER, roleMeta } from '../roles';
import { brandSidebar, colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';

// Demo accounts the quick-fill grid populates — the three WEB PORTAL roles
// (see src/roles.js). Staff is deliberately absent: per the role spec the
// Inventory Staff experience is the MOBILE app only (QR scanning, counts,
// adjustment requests) — the backend refuses a staff login sent with the
// portal flag (403 portal_mobile_only). Kept in one place so the buttons and
// the credential hints below can never drift apart.
const DEMO_ACCOUNTS = [
  { label: 'Owner', username: 'owner', password: 'owner123', note: 'full oversight' },
  { label: 'Super Admin', username: 'superadmin', password: 'super123', note: 'accounts & roles' },
  { label: 'Admin', username: 'admin', password: 'admin123', note: 'products & approvals' },
];

// Landing route per role. All portal roles land on the dashboard.
function homeForRole(role) {
  return '/';
}

export default function LoginPage({ onLogin }) {
  usePageTitle('/');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const [showDemo, setShowDemo] = useState(false);
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
  const fillDemo = (username) => {
    const account = DEMO_ACCOUNTS.find((a) => a.username === username);
    if (!account) return;
    setUsername(account.username);
    setPassword(account.password);
    setError('');
  };

  const handleSubmit = async() => {
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
        // portal: 'admin' tells the backend this login came from the web
        // portal, so it refuses mobile-only (staff) accounts with a 403
        // portal_mobile_only response instead of a session.
        body: JSON.stringify({ username, password, portal: 'admin' }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Brute-force lockout: surface the wait and disable the button until
        // the backend says the account unlocks (retryAfterSeconds).
        if (res.status === 429 && data.retryAfterSeconds) {
          setLockoutLeft(data.retryAfterSeconds);
          setError(
            `Too many failed login attempts. Try again in ${data.retryAfterSeconds}s.`,
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
      // Portal gate (belt to the backend's suspenders): the web admin is a
      // desktop surface for the admin tier only. Staff authenticate fine on
      // the backend (the 403 above fires when portal is set) — this client
      // check keeps the door shut even against an older backend that doesn't
      // send the flag yet.
      if (!data.user || !ADMIN_TIER.includes(data.user.role)) {
        setError(
          data.user && data.user.role === 'staff'
            ? 'Inventory Staff accounts are mobile-only — scan QR tags and submit counts from the INVENTRAK mobile app instead.'
            : 'This account does not have web admin access.',
        );
        return;
      }
      setToken(data.token);
      setSnackbar({ open: true, message: 'Login successful!', severity: 'success' });
      setTimeout(() => {
        onLogin(data.user);
        // Always land on this role's home after login, regardless of which
        // page the user was on before (e.g. logged out from Products).
        window.location.href = homeForRole(data.user.role);
      }, 500);
    } catch (err) {
      setError('Network error — could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Second factor: exchange the challenge token + authenticator code for a
  // real session. The challenge expires in 10 minutes.
  const handleMfaSubmit = async() => {
    if (!mfaCode) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await mfaVerify({ mfaToken, code: mfaCode });
      if (!data.user || !ADMIN_TIER.includes(data.user.role)) {
        setError('This account does not have web admin access.');
        return;
      }
      setToken(data.token);
      setMfaToken(null);
      setSnackbar({ open: true, message: 'MFA verified — login successful!', severity: 'success' });
      setTimeout(() => {
        onLogin(data.user);
        window.location.href = homeForRole(data.user.role);
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
    <>
      <ShaderGradientBg />
      <Container
        maxWidth="sm"
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 8,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ width: '100%' }}
        >
          <Paper sx={{ width: '100%', p: { xs: 3, md: 5 }, borderRadius: 4, boxShadow: '0 30px 90px rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(10px)', backgroundColor: 'rgba(255, 255, 255, 0.95)' }}>
            <Box sx={{ mb: 3, p: 3, borderRadius: 3, backgroundColor: brandSidebar, color: '#fff' }}>
              <Typography variant="h5" component="div" gutterBottom>
            INVENTRAK Admin
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
            Secure inventory controls and analytics.
              </Typography>
            </Box>

            <Typography variant="subtitle1" sx={{ mb: 2, color: colors.textSecondary }}>
          Sign in with your admin credentials to manage products, inventory, and orders.
          Roles: Owner, Super Admin, Admin — Inventory Staff sign in from the mobile app instead.
            </Typography>

            {/* Demo quick-fill: one tap per role populates the account, then press
            Login. Covers all four sign-in roles so nothing is typed on stage. */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 1.5,
                mb: 1,
              }}
            >
              {DEMO_ACCOUNTS.map((account) => {
                const meta = roleMeta(account.username);
                return (
                  <motion.div
                    key={account.username}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Button
                      fullWidth
                      variant="contained"
                      onClick={() => fillDemo(account.username)}
                      startIcon={<AdminPanelSettingsOutlined />}
                      disabled={loading}
                      aria-label={`Fill ${account.label} demo account`}
                      sx={{
                        py: 1.25,
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 0.25,
                        backgroundColor: meta.color,
                        '&:hover': { backgroundColor: meta.color, filter: 'brightness(0.92)' },
                        textTransform: 'none',
                      }}
                    >
                      <Box sx={{ fontWeight: 800, letterSpacing: 0.5 }}>{account.label}</Box>
                      <Box sx={{ fontSize: '0.7rem', opacity: 0.92, lineHeight: 1.2, textAlign: 'left' }}>
                        <span>{showDemo ? `${account.username} / ${account.password}` : 'Tap to fill'}</span>
                        {` · ${account.note}`}
                      </Box>
                    </Button>
                  </motion.div>
                );
              })}
            </Box>
            <Typography
              variant="caption"
              sx={{ display: 'block', mb: 3, color: colors.textSecondary, cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => setShowDemo(s => !s)}
            >
              {showDemo ? 'Hide demo credentials' : 'Show demo credentials'} — one tap fills the account, then press Login.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mb: 3, color: colors.textSecondary }}>
          📱 Inventory Staff: sign in from the INVENTRAK mobile app to scan QR tags and submit counts — this portal is desktop-only.
            </Typography>

            {error ? <Alert severity="error" sx={{ mb: 2 }} aria-live="polite">{error}</Alert> : null}
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
                  {loading ? 'Verifying…' : 'Verify code'}
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
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button fullWidth variant="contained" color="secondary" onClick={handleSubmit} disabled={loading || lockoutLeft > 0} size="large" sx={{ mt: 2 }}>
                    {loading
                      ? 'Signing in…'
                      : lockoutLeft > 0
                        ? `Locked — try again in ${lockoutLeft}s`
                        : 'Login'}
                  </Button>
                </motion.div>
              </>
            )}
          </Paper>
        </motion.div>
      </Container>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </>
  );
}

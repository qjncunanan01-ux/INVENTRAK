import { Alert, Box, Button, Container, Paper, Snackbar, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { API_BASE_URL, setToken } from '../api';
import { colors } from '../theme';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const handleSubmit = async () => {
    if (!username || !password) {
      setError('Please enter username and password');
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
        setError(data.error || 'Login failed');
        return;
      }
      setToken(data.token);
      setSnackbar({ open: true, message: 'Login successful!', severity: 'success' });
      setTimeout(() => onLogin(data.user), 500);
    } catch (err) {
      setError('Network error. Please ensure the backend server is running on port 4001.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
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
        <Box sx={{ mb: 3, p: 3, borderRadius: 3, backgroundColor: colors.brandPrimary, color: '#fff' }}>
          <Typography variant="h5" component="div" gutterBottom>
            INVENTRAK Admin
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            Secure inventory controls and analytics.
          </Typography>
        </Box>

        <Typography variant="subtitle1" sx={{ mb: 3, color: colors.textSecondary }}>
          Sign in with your admin credentials to manage products, inventory, and orders.
        </Typography>
        <Typography variant="caption" sx={{ mb: 2, display: 'block', color: colors.textSecondary }}>
          Demo: username <strong>admin</strong> / password <strong>admin123</strong>
        </Typography>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        <TextField
          fullWidth
          variant="outlined"
          label="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ mb: 2 }}
          disabled={loading}
        />
        <TextField
          fullWidth
          variant="outlined"
          label="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ mb: 3 }}
          disabled={loading}
        />
        <Button fullWidth variant="contained" color="secondary" onClick={handleSubmit} disabled={loading} size="large">
          {loading ? 'Signing in...' : 'Login'}
        </Button>
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

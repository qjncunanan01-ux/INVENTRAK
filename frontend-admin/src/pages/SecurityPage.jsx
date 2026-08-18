import { Alert, Box, Button, Card, CardContent, Chip, Divider, Link, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { mfaConfirm, mfaDisable, mfaRecoveryCodes, mfaSetup } from '../api';
import { colors } from '../theme';

// Admin Security page — two-factor authentication management. Enabling MFA
// means every future admin login needs a code from the authenticator app in
// addition to the password (defense in depth: a leaked password alone can no
// longer open the dashboard).
export default function SecurityPage({ onLogout }) {
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [pending, setPending] = useState(null); // { secret, otpauth_url } from setup
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  // One-time recovery codes — shown exactly once after enrollment/regeneration.
  const [recoveryCodes, setRecoveryCodes] = useState(null);

  const handleStartSetup = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const data = await mfaSetup();
      setPending({ secret: data.secret, otpauth_url: data.otpauth_url });
    } catch (err) {
      if (err.status === 409) setMfaEnabled(true); // already enabled server-side
      else setError(err.message || 'Could not start MFA setup');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!code) return setError('Enter the 6-digit code from your authenticator app.');
    setLoading(true);
    setError('');
    try {
      const data = await mfaConfirm({ code });
      setMfaEnabled(true);
      setPending(null);
      setCode('');
      setRecoveryCodes(data.recovery_codes || null);
      setInfo('Two-factor authentication is now enabled for this account.');
    } catch (err) {
      setError(err.message || 'Invalid code. Check that the time on your phone is correct.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await mfaRecoveryCodes();
      setRecoveryCodes(data.recovery_codes || null);
      setInfo('New recovery codes generated — the previous set is now invalid.');
    } catch (err) {
      setError(err.message || 'Could not regenerate recovery codes.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!code) return setError('Enter a current 6-digit code to disable MFA.');
    setLoading(true);
    setError('');
    try {
      await mfaDisable({ code });
      setMfaEnabled(false);
      setCode('');
      setInfo('Two-factor authentication is now disabled.');
    } catch (err) {
      setError(err.message || 'Invalid code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Security
      </Typography>
      <Typography variant="body2" sx={{ color: colors.textSecondary, mb: 3 }}>
        Two-factor authentication (MFA) — required for the administrator account.
      </Typography>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {info ? <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert> : null}

      <Card sx={{ maxWidth: 640, mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6">Two-factor authentication</Typography>
            <Chip
              label={mfaEnabled ? 'Enabled' : 'Disabled'}
              color={mfaEnabled ? 'success' : 'default'}
              size="small"
            />
          </Box>
          <Typography variant="body2" sx={{ color: colors.textSecondary, mb: 2 }}>
            {mfaEnabled
              ? 'Your account requires a 6-digit code from your authenticator app on every login.'
              : 'Enable it to require a 6-digit code from an authenticator app (Google Authenticator, Authy, Microsoft Authenticator) on every login.'}
          </Typography>

          {pending ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                1. Add this secret to your authenticator app
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Scan the QR code (below) or type the secret manually:
              </Typography>
              <Box
                component="img"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pending.otpauth_url)}`}
                alt="MFA QR code"
                sx={{ width: 180, height: 180, borderRadius: 2, border: '1px solid', borderColor: 'divider', mb: 1 }}
              />
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mb: 1 }}>
                {pending.secret}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: colors.textSecondary, mb: 2 }}>
                Prefer manual entry? Use this link:{' '}
                <Link href={pending.otpauth_url} target="_blank" rel="noreferrer">
                  open otpauth link
                </Link>
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                2. Confirm with a live code
              </Typography>
              <TextField
                label="6-digit code"
                value={code}
                onChange={e => setCode(e.target.value)}
                inputProps={{ maxLength: 6, inputMode: 'numeric' }}
                sx={{ mb: 1, width: 220 }}
                disabled={loading}
              />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="contained" color="secondary" onClick={handleConfirm} disabled={loading}>
                  {loading ? 'Verifying...' : 'Enable MFA'}
                </Button>
                <Button variant="text" onClick={() => { setPending(null); setError(''); }} disabled={loading}>
                  Cancel
                </Button>
              </Box>
            </Box>
          ) : (
            <Button
              variant={mfaEnabled ? 'outlined' : 'contained'}
              color={mfaEnabled ? 'error' : 'secondary'}
              onClick={mfaEnabled ? handleDisable : handleStartSetup}
              disabled={loading}
            >
              {loading ? 'Working...' : mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
            </Button>
          )}

          {mfaEnabled && !pending && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <TextField
                label="Current code (to disable)"
                value={code}
                onChange={e => setCode(e.target.value)}
                inputProps={{ maxLength: 6, inputMode: 'numeric' }}
                sx={{ width: 220 }}
                disabled={loading}
              />
              <Button variant="outlined" color="secondary" onClick={handleRegenerate} disabled={loading}>
                Regenerate recovery codes
              </Button>
            </Box>
          )}

          {recoveryCodes && (
            <Box sx={{ mt: 3, p: 2, borderRadius: 2, border: '1px solid', borderColor: 'warning.main', backgroundColor: 'rgba(255, 193, 7, 0.08)' }}>
              <Typography variant="subtitle2" gutterBottom sx={{ color: 'warning.dark' }}>
                ⚠️ Save these one-time recovery codes now — they are shown only once
              </Typography>
              <Typography variant="body2" sx={{ color: colors.textSecondary, mb: 1 }}>
                If you lose your phone, enter any unused code instead of the authenticator code at login. Each code works once.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' }, gap: 1 }}>
                {recoveryCodes.map((c) => (
                  <Box key={c} sx={{ fontFamily: 'monospace', fontSize: 13, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1, py: 0.5, textAlign: 'center' }}>
                    {c}
                  </Box>
                ))}
              </Box>
              <Button variant="text" size="small" sx={{ mt: 1 }} onClick={() => setRecoveryCodes(null)}>
                I've saved them — hide
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      <Typography variant="body2" sx={{ color: colors.textSecondary }}>
        All login attempts and security changes are recorded in the server audit log.
      </Typography>
      <Divider sx={{ my: 3 }} />
      <Button variant="text" color="error" onClick={onLogout}>
        Log out
      </Button>
    </Box>
  );
}

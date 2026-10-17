import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { apiGet } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

// Delivery status -> chip colour. 'logged' is the honest state when no email /
// SMS provider is configured (the message only reached the server log), so it
// must not look like a success.
const STATUS_COLOR = {
  sent: 'success',
  delivered: 'success',
  logged: 'default',
  failed: 'error',
  attempted: 'warning',
};

export default function NotificationsPage({ onLogout }) {
  usePageTitle('/notifications');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (event) params.set('event', event);
      if (channel) params.set('channel', channel);
      if (status) params.set('status', status);
      const qs = params.toString();
      const response = await apiGet(`/api/notifications${qs ? `?${qs}` : ''}`);
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setTotal(response?.total ?? 0);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [event, channel, status]);

  useEffect(() => { load(); }, [load]);

  return (
    <AdminLayout title="Notifications" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Notification ledger</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Every notification the system attempted — email and SMS — with its best-effort delivery
          status. “Logged” means no provider is configured, so the message only reached the server log.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <TextField
            select
            size="small"
            label="Event"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            sx={{ minWidth: 200, backgroundColor: colors.surface }}
          >
            <MenuItem value="">All events</MenuItem>
            <MenuItem value="verification">Verification</MenuItem>
            <MenuItem value="welcome">Welcome</MenuItem>
            <MenuItem value="password_reset">Password reset</MenuItem>
            <MenuItem value="inquiry_status">Order inquiry status</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            sx={{ minWidth: 170, backgroundColor: colors.surface }}
          >
            <MenuItem value="">All channels</MenuItem>
            <MenuItem value="email">Email</MenuItem>
            <MenuItem value="sms">SMS</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ minWidth: 170, backgroundColor: colors.surface }}
          >
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="sent">Sent</MenuItem>
            <MenuItem value="logged">Logged</MenuItem>
            <MenuItem value="failed">Failed</MenuItem>
          </TextField>
          <Button variant="outlined" onClick={load}>Refresh</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Records ({total})</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Event</TableCell>
                <TableCell>Channel</TableCell>
                <TableCell>Recipient</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6}>No notification records yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</TableCell>
                  <TableCell>{r.event || '—'}</TableCell>
                  <TableCell>{r.channel || '—'}</TableCell>
                  <TableCell>{r.recipient || '—'}</TableCell>
                  <TableCell>{r.subject || r.detail || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={r.status || 'unknown'} color={STATUS_COLOR[r.status] || 'default'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

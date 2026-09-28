import { Box, Button, Chip, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';

// How often the open page re-checks the server for new staff submissions.
// Mirrors the staff app's Requests screen (15s there, 15s here) so the full
// staff → owner loop plays out live on both ends: a phone submits, this
// queue shows the new "Requested by" row within one tick, and the decision
// lands back on the phone the same way. Only while the tab is visible.
const AUTO_REFRESH_MS = 15000;

export default function ApprovalsPage({ onLogout }) {
  usePageTitle('/approvals');
  const [data, setData] = useState({ adjustments: [], transfers: [] });
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [lastSynced, setLastSynced] = useState(null);
  // Re-entrancy guard: a Render cold start can take 30s+, so timer ticks can
  // overlap an in-flight request. Skip a tick rather than pile up requests.
  const inFlight = useRef(false);

  // `silent` refreshes swap the data in place (no Loading… flicker, no error
  // snackbar spam while the backend briefly hiccups); the first load and
  // explicit reloads keep the original visible-loading behavior.
  const loadData = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiGet('/api/approvals');
      setData({ adjustments: res.adjustments || [], transfers: res.transfers || [] });
      setLastSynced(new Date());
    } catch (err) {
      // Silent (timer) polls keep the last good queue on failure; only
      // user-driven loads surface the error.
      if (!silent) setSnackbar({ open: true, message: 'Failed to load approvals: ' + err.message, severity: 'error' });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Live queue: poll while the page is open, skipping ticks while the
  // browser tab is hidden (no wasted requests in a background tab).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadData(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  const decide = async(kind, id, action) => {
    try {
      const result = await apiPost(`/api/stock-${kind === 'adjustment' ? 'adjustments' : 'transfers'}/${id}/${action}`, {});
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      await loadData(true);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  const total = adjustments.length + transfers.length;

  return (
    <AdminLayout title="Approvals" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Approval of important transactions</Typography>
        <Typography variant="body2" color="text.secondary">
          {loading ? 'Loading pending requests...' : `${total} pending request${total === 1 ? '' : 's'} awaiting your decision. Approving applies the change to stock; rejecting leaves stock untouched.`}
        </Typography>
        {/* Live queue: new staff submissions appear here on their own — no
            reload needed (mirrors the staff app's live Requests screen). */}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {lastSynced
            ? `Live · updated ${lastSynced.toLocaleTimeString()} · checks every 15s`
            : 'Live · checks every 15s'}
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Pending stock adjustments ({adjustments.length})</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Current → Corrected</TableCell>
              <TableCell>Best before</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Requested by</TableCell>
              <TableCell>Requested</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8}>Loading…</TableCell></TableRow>
            ) : adjustments.length === 0 ? (
              <TableRow><TableCell colSpan={8}>No pending adjustments.</TableCell></TableRow>
            ) : adjustments.map(r => (
              <TableRow key={'a' + r.id}>
                <TableCell>{r.product_name}</TableCell>
                <TableCell>{r.location_name}</TableCell>
                <TableCell>{r.current_qty} → <strong>{r.new_qty}</strong></TableCell>
                <TableCell>
                  {r.expiry_date
                    ? <Chip size="small" color="warning" label={r.expiry_date} />
                    : '—'}
                </TableCell>
                <TableCell>{r.reason || '-'}</TableCell>
                {/* Submitter identity — who physically counted this stock (the
                    staff app stamps it on submit; legacy rows show '—'). */}
                <TableCell>{r.created_by || '—'}</TableCell>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" variant="contained" color="success" onClick={() => decide('adjustment', r.id, 'approve')}>
                      {r.expiry_date ? '✓ Approve & stamp expiry' : '✓ Approve'}
                    </Button>
                    <Button size="small" variant="outlined" color="error" onClick={() => decide('adjustment', r.id, 'reject')}>✕ Reject</Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Pending stock transfers ({transfers.length})</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>From → To</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Requested</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
            ) : transfers.length === 0 ? (
              <TableRow><TableCell colSpan={6}>No pending transfers.</TableCell></TableRow>
            ) : transfers.map(r => (
              <TableRow key={'t' + r.id}>
                <TableCell>{r.product_name}</TableCell>
                <TableCell>{r.src_location_name} → {r.dst_location_name}</TableCell>
                <TableCell><strong>{r.qty}</strong></TableCell>
                <TableCell>{r.reason || '-'}</TableCell>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" variant="contained" color="success" onClick={() => decide('transfer', r.id, 'approve')}>✓ Approve</Button>
                    <Button size="small" variant="outlined" color="error" onClick={() => decide('transfer', r.id, 'reject')}>✕ Reject</Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} message={snackbar.message} />
    </AdminLayout>
  );
}

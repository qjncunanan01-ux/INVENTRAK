import { Box, Button, Chip, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function ApprovalsPage({ onLogout }) {
  const [data, setData] = useState({ adjustments: [], transfers: [] });
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiGet('/api/approvals');
      setData({ adjustments: res.adjustments || [], transfers: res.transfers || [] });
    } catch (err) {
      setSnackbar({ open: true, message: 'Failed to load approvals: ' + err.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const decide = async (kind, id, action) => {
    try {
      const result = await apiPost(`/api/stock-${kind === 'adjustment' ? 'adjustments' : 'transfers'}/${id}/${action}`, {});
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      await loadData();
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
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Pending stock adjustments ({adjustments.length})</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Current → Corrected</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Requested</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
            ) : adjustments.length === 0 ? (
              <TableRow><TableCell colSpan={6}>No pending adjustments.</TableCell></TableRow>
            ) : adjustments.map(r => (
              <TableRow key={'a' + r.id}>
                <TableCell>{r.product_name}</TableCell>
                <TableCell>{r.location_name}</TableCell>
                <TableCell>{r.current_qty} → <strong>{r.new_qty}</strong></TableCell>
                <TableCell>{r.reason || '-'}</TableCell>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" variant="contained" color="success" onClick={() => decide('adjustment', r.id, 'approve')}>✓ Approve</Button>
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

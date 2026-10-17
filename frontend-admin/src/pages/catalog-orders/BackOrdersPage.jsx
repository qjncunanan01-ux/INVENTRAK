import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
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
import { apiGet, apiPost } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

const STATUS_COLOR = {
  open: 'warning',
  fulfilled: 'success',
  cancelled: 'default',
};

// Back-order management: one row per order inquiry that could not be fully
// fulfilled. The admin records the reason and the customer's requested date,
// then advances the status as supply arrives.
export default function BackOrdersPage({ onLogout }) {
  usePageTitle('/back-orders');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inquiryId, setInquiryId] = useState('');
  const [reason, setReason] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [note, setNote] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet('/api/back-orders');
      setRows(Array.isArray(response) ? response : []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (body) => {
    setSaving(true);
    try {
      await apiPost('/api/back-orders', body);
      setSnackbar({ open: true, message: 'Back order saved', severity: 'success' });
      await load();
      return true;
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const ok = await save({
      inquiry_id: Number(inquiryId),
      reason,
      requested_by_date: requestedBy || null,
      note: note || null,
    });
    if (ok) {
      setInquiryId('');
      setReason('');
      setRequestedBy('');
      setNote('');
    }
  };

  const advance = (row, status) => save({ inquiry_id: row.inquiry_id, status });

  return (
    <AdminLayout title="Back Orders" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Record a back order</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Attach a back order to an order-inquiry id when it cannot be fully fulfilled. Saving the
          same inquiry id again updates that row instead of creating a duplicate.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <TextField
            size="small"
            label="Order inquiry id"
            type="number"
            value={inquiryId}
            onChange={(e) => setInquiryId(e.target.value)}
            sx={{ minWidth: 170, backgroundColor: colors.surface }}
          />
          <TextField
            size="small"
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            sx={{ minWidth: 220, flex: 1, backgroundColor: colors.surface }}
          />
          <TextField
            size="small"
            label="Requested by date"
            type="date"
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 190, backgroundColor: colors.surface }}
          />
          <TextField
            size="small"
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            sx={{ minWidth: 200, flex: 1, backgroundColor: colors.surface }}
          />
          <Button variant="contained" onClick={handleCreate} disabled={saving || !inquiryId}>
            Save back order
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Back orders</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Inquiry</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Note</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6}>No back orders recorded</TableCell></TableRow>
              ) : rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.inquiry_id}</TableCell>
                  <TableCell>{b.reason || '—'}</TableCell>
                  <TableCell>{b.requested_by_date || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={b.status} color={STATUS_COLOR[b.status] || 'default'} />
                  </TableCell>
                  <TableCell>{b.note || '—'}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={saving || b.status === 'fulfilled'}
                        onClick={() => advance(b, 'fulfilled')}
                      >
                        Fulfil
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        disabled={saving || b.status === 'cancelled'}
                        onClick={() => advance(b, 'cancelled')}
                      >
                        Cancel
                      </Button>
                    </Box>
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

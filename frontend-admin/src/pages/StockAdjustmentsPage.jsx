import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, getCurrentUser } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const statusColor = (s) => (s === 'pending' ? 'warning' : s === 'approved' ? 'success' : 'error');

export default function StockAdjustmentsPage({ onLogout }) {
  // Staff propose adjustments but only the owner decides them — so the
  // "Go to Approvals" quick-link and the Approve/Reject buttons are
  // admin-only (mirrors the backend's adminOnly decision routes).
  const isStaff = getCurrentUser()?.role === 'staff';
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [form, setForm] = useState({ product_id: '', location_id: '', new_qty: '', reason: '' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [adjRes, prodRes, locRes] = await Promise.all([
        apiGet(`/api/stock-adjustments${statusFilter ? `?status=${statusFilter}` : ''}`),
        apiGet('/api/products'),
        apiGet('/api/locations'),
      ]);
      setRows(adjRes);
      setProducts(prodRes.data || prodRes);
      setLocations(locRes);
    } catch (err) {
      setSnackbar({ open: true, message: 'Failed to load data: ' + err.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [statusFilter]);

  const handleSubmit = async () => {
    if (!form.product_id || !form.location_id || form.new_qty === '') {
      setSnackbar({ open: true, message: 'Select a product, location, and enter the corrected quantity', severity: 'warning' });
      return;
    }
    if (Number(form.new_qty) < 0) {
      setSnackbar({ open: true, message: 'Quantity cannot be negative', severity: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/stock-adjustments', {
        product_id: Number(form.product_id),
        location_id: Number(form.location_id),
        new_qty: Number(form.new_qty),
        reason: form.reason,
      });
      setSnackbar({ open: true, message: 'Adjustment created — pending approval', severity: 'success' });
      setForm({ product_id: '', location_id: '', new_qty: '', reason: '' });
      await loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id, action) => {
    try {
      const result = await apiPost(`/api/stock-adjustments/${id}/${action}`, {});
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      await loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const prodList = Array.isArray(products) ? products : [];
  const locList = Array.isArray(locations) ? locations : [];
  const filtered = (Array.isArray(rows) ? rows : []).filter(r => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (r.product_name || '').toLowerCase().includes(q) ||
      (r.location_name || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q);
  });

  return (
    <AdminLayout title="Stock Adjustments" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>New adjustment request</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Propose a corrected quantity (inventory count, damage, shrinkage). The change only applies to stock after an admin approves it.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>Product</InputLabel>
            <Select value={form.product_id} label="Product" onChange={e => setForm({ ...form, product_id: e.target.value })}>
              {prodList.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>Location</InputLabel>
            <Select value={form.location_id} label="Location" onChange={e => setForm({ ...form, location_id: e.target.value })}>
              {locList.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            label="Corrected quantity"
            type="text"
            inputMode="decimal"
            value={form.new_qty}
            onChange={e => setForm({ ...form, new_qty: e.target.value.replace(/[^0-9.]/g, '') })}
            fullWidth
            sx={{ backgroundColor: colors.surface }}
          />
          <TextField
            label="Reason"
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            fullWidth
            sx={{ backgroundColor: colors.surface }}
          />
          <Button variant="contained" color="secondary" onClick={handleSubmit} disabled={saving || !form.product_id || !form.location_id || form.new_qty === ''}>
            {saving ? 'Saving...' : 'Request adjustment'}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6">Adjustment history</Typography>
            {!isStaff && (
              <Button
                size="small"
                variant="outlined"
                component={Link}
                to="/approvals"
                sx={{ color: colors.brandPrimary, borderColor: colors.brandPrimary }}
              >
                → Go to Approvals
              </Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 150, backgroundColor: colors.surface }}>
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={e => setStatusFilter(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" label="Search product / location / reason..." value={search} onChange={e => setSearch(e.target.value)} sx={{ minWidth: 240, backgroundColor: colors.surface }} />
          </Box>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Current</TableCell>
              <TableCell>Corrected to</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Decided by</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9}>Loading adjustments...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9}>No adjustments found.</TableCell></TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id}>
                <TableCell>{r.product_name}</TableCell>
                <TableCell>{r.location_name}</TableCell>
                <TableCell>{r.current_qty}</TableCell>
                <TableCell><strong>{r.new_qty}</strong></TableCell>
                <TableCell>{r.reason || '-'}</TableCell>
                <TableCell><Chip size="small" color={statusColor(r.status)} label={r.status} /></TableCell>
                <TableCell>{r.decided_by || '-'}</TableCell>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {r.status === 'pending' ? (
                    isStaff ? (
                      <Chip size="small" label="Awaiting owner" />
                    ) : (
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button size="small" variant="contained" color="success" onClick={() => decide(r.id, 'approve')}>✓ Approve</Button>
                        <Button size="small" variant="outlined" color="error" onClick={() => decide(r.id, 'reject')}>✕ Reject</Button>
                      </Box>
                    )
                  ) : '-'}
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

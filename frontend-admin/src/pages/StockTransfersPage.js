import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const statusColor = (s) => (s === 'pending' ? 'warning' : s === 'approved' ? 'success' : 'error');

export default function StockTransfersPage({ onLogout }) {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [form, setForm] = useState({ product_id: '', src_location: '', dst_location: '', qty: '', reason: '' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [trRes, prodRes, locRes] = await Promise.all([
        apiGet(`/api/stock-transfers${statusFilter ? `?status=${statusFilter}` : ''}`),
        apiGet('/api/products'),
        apiGet('/api/locations'),
      ]);
      setRows(trRes);
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
    if (!form.product_id || !form.src_location || !form.dst_location || !form.qty) {
      setSnackbar({ open: true, message: 'Select product, both locations, and enter quantity', severity: 'warning' });
      return;
    }
    if (Number(form.src_location) === Number(form.dst_location)) {
      setSnackbar({ open: true, message: 'Source and destination must differ', severity: 'warning' });
      return;
    }
    if (Number(form.qty) <= 0) {
      setSnackbar({ open: true, message: 'Quantity must be greater than 0', severity: 'warning' });
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/stock-transfers', {
        product_id: Number(form.product_id),
        src_location: Number(form.src_location),
        dst_location: Number(form.dst_location),
        qty: Number(form.qty),
        reason: form.reason,
      });
      setSnackbar({ open: true, message: 'Transfer created — pending approval', severity: 'success' });
      setForm({ product_id: '', src_location: '', dst_location: '', qty: '', reason: '' });
      await loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id, action) => {
    try {
      const result = await apiPost(`/api/stock-transfers/${id}/${action}`, {});
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
      (r.src_location_name || '').toLowerCase().includes(q) ||
      (r.dst_location_name || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q);
  });

  return (
    <AdminLayout title="Stock Transfers" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>New transfer request</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Move stock between locations. The transfer only happens after an admin approves it.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>Product</InputLabel>
            <Select value={form.product_id} label="Product" onChange={e => setForm({ ...form, product_id: e.target.value })}>
              {prodList.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>From location</InputLabel>
            <Select value={form.src_location} label="From location" onChange={e => setForm({ ...form, src_location: e.target.value })}>
              {locList.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>To location</InputLabel>
            <Select value={form.dst_location} label="To location" onChange={e => setForm({ ...form, dst_location: e.target.value })}>
              {locList.map(l => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            label="Quantity"
            type="text"
            inputMode="decimal"
            value={form.qty}
            onChange={e => setForm({ ...form, qty: e.target.value.replace(/[^0-9.]/g, '') })}
            fullWidth
            sx={{ backgroundColor: colors.surface }}
          />
          <TextField label="Reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} fullWidth sx={{ backgroundColor: colors.surface }} />
          <Button variant="contained" color="secondary" onClick={handleSubmit} disabled={saving || !form.product_id || !form.src_location || !form.dst_location || !form.qty}>
            {saving ? 'Saving...' : 'Request transfer'}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="h6">Transfer history</Typography>
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
              <TableCell>From</TableCell>
              <TableCell>To</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Decided by</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9}>Loading transfers...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9}>No transfers found.</TableCell></TableRow>
            ) : filtered.map(r => (
              <TableRow key={r.id}>
                <TableCell>{r.product_name}</TableCell>
                <TableCell>{r.src_location_name}</TableCell>
                <TableCell>{r.dst_location_name}</TableCell>
                <TableCell><strong>{r.qty}</strong></TableCell>
                <TableCell>{r.reason || '-'}</TableCell>
                <TableCell><Chip size="small" color={statusColor(r.status)} label={r.status} /></TableCell>
                <TableCell>{r.decided_by || '-'}</TableCell>
                <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {r.status === 'pending' ? (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" variant="contained" color="success" onClick={() => decide(r.id, 'approve')}>✓ Approve</Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => decide(r.id, 'reject')}>✕ Reject</Button>
                    </Box>
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

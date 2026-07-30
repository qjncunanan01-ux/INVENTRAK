import { Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function StockMovementPage({ onLogout }) {
  const [movements, setMovements] = useState([]);
  const [lots, setLots] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [totalMovements, setTotalMovements] = useState(0);
  const [form, setForm] = useState({ type: 'stock-in', product_id: '', qty: '', src_location: '', dst_location: '', notes: '' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [movRes, prodRes, locRes, lotRes] = await Promise.all([
        apiGet('/api/stock-movements'),
        apiGet('/api/products'),
        apiGet('/api/locations'),
        apiGet('/api/stock-lots')
      ]);
      setMovements(movRes.data || movRes);
      setTotalMovements(movRes.pagination?.total || (movRes.data || movRes).length);
      setProducts(prodRes.data || prodRes);
      setLocations(locRes);
      setLots(lotRes);
    } catch (err) {
      setSnackbar({ open: true, message: 'Failed to load data: ' + err.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async () => {
    if (!form.product_id || !form.qty) {
      setSnackbar({ open: true, message: 'Please select a product and enter quantity', severity: 'warning' });
      return;
    }
    if (Number(form.qty) <= 0) {
      setSnackbar({ open: true, message: 'Quantity must be greater than 0', severity: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const result = await apiPost('/api/stock-movement', {
        product_id: Number(form.product_id),
        qty: Number(form.qty),
        type: form.type,
        src_location: form.src_location,
        dst_location: form.dst_location,
        notes: form.notes,
        user: 'admin'
      });
      setSnackbar({ open: true, message: result.message || 'Movement recorded', severity: 'success' });
      setForm({ type: 'stock-in', product_id: '', qty: '', src_location: '', dst_location: '', notes: '' });
      await loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const movList = Array.isArray(movements) ? movements : [];
  const prodList = Array.isArray(products) ? products : [];
  const locList = Array.isArray(locations) ? locations : [];
  const lotList = Array.isArray(lots) ? lots : [];

  const productMap = prodList.reduce((acc, item) => ({ ...acc, [item.id]: item.name }), {});
  const locationMap = locList.reduce((acc, item) => ({ ...acc, [item.id]: item.name }), {});
  const showSrc = form.type === 'stock-out' || form.type === 'transfer' || form.type === 'adjustment';
  const showDst = form.type === 'stock-in' || form.type === 'transfer' || form.type === 'adjustment';

  return (
    <AdminLayout title="Stock Movement" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>New stock movement</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Record stock in, stock out, transfers, and adjustments with FIFO tracking.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>Movement type</InputLabel>
            <Select value={form.type} label="Movement type" onChange={e => setForm({ ...form, type: e.target.value })}>
              <MenuItem value="stock-in">Stock In</MenuItem>
              <MenuItem value="stock-out">Stock Out</MenuItem>
              <MenuItem value="transfer">Transfer</MenuItem>
              <MenuItem value="adjustment">Adjustment</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth sx={{ backgroundColor: colors.surface }}>
            <InputLabel>Product</InputLabel>
            <Select value={form.product_id} label="Product" onChange={e => setForm({ ...form, product_id: e.target.value })}>
              {prodList.map(product => (
                <MenuItem key={product.id} value={product.id}>{product.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Quantity" type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} fullWidth />
          {showSrc && (
            <FormControl fullWidth>
              <InputLabel>Source location</InputLabel>
              <Select value={form.src_location} label="Source location" onChange={e => setForm({ ...form, src_location: e.target.value })}>
                <MenuItem value="">None</MenuItem>
                {locList.map(loc => <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {showDst && (
            <FormControl fullWidth>
              <InputLabel>Destination location</InputLabel>
              <Select value={form.dst_location} label="Destination location" onChange={e => setForm({ ...form, dst_location: e.target.value })}>
                <MenuItem value="">None</MenuItem>
                {locList.map(loc => <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          <TextField label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} multiline rows={2} fullWidth sx={{ backgroundColor: colors.surface }} />
          <Button variant="contained" color="secondary" onClick={handleSubmit} disabled={saving || !form.product_id || !form.qty}>
            {saving ? 'Saving...' : 'Submit movement'}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">Recent stock movements</Typography>
          <Typography variant="body2" color="text.secondary">Total: {totalMovements}</Typography>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>Quantity</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Destination</TableCell>
              <TableCell>Date</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading stock movements...</TableCell></TableRow>
            ) : movList.length === 0 ? (
              <TableRow><TableCell colSpan={6}>No stock movements found.</TableCell></TableRow>
            ) : movList.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell>{movement.type}</TableCell>
                <TableCell>{productMap[movement.product_id] ?? movement.product_id}</TableCell>
                <TableCell>{movement.qty}</TableCell>
                <TableCell>{(locationMap[movement.src_location] ?? movement.src_location) || '-'}</TableCell>
                <TableCell>{(locationMap[movement.dst_location] ?? movement.dst_location) || '-'}</TableCell>
                <TableCell>{new Date(movement.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Paper sx={{ p: 3, mt: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Stock lots (FIFO view)</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Qty</TableCell>
              <TableCell>Received</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4}>Loading lots...</TableCell></TableRow>
            ) : lotList.length === 0 ? (
              <TableRow><TableCell colSpan={4}>No lot data available.</TableCell></TableRow>
            ) : lotList.map(lot => (
              <TableRow key={lot.id}>
                <TableCell>{lot.product_name}</TableCell>
                <TableCell>{lot.location_name}</TableCell>
                <TableCell>{lot.qty}</TableCell>
                <TableCell>{new Date(lot.received_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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

import { Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function StockMovementPage({ onLogout }) {
  const [movements, setMovements] = useState([]);
  const [lots, setLots] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type: 'stock-in', product_id: '', qty: '', src_location: '', dst_location: '', notes: '' });

  const loadData = async () => {
    setLoading(true);
    const [movRes, prodRes, locRes, lotRes] = await Promise.all([
      axios.get(`${API_BASE_URL}/api/stock-movements`),
      axios.get(`${API_BASE_URL}/api/products`),
      axios.get(`${API_BASE_URL}/api/locations`),
      axios.get(`${API_BASE_URL}/api/stock-lots`)
    ]);
    setMovements(movRes.data);
    setProducts(prodRes.data);
    setLocations(locRes.data);
    setLots(lotRes.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async () => {
    setSaving(true);
    await axios.post(`${API_BASE_URL}/api/stock-movement`, {
      product_id: Number(form.product_id),
      qty: Number(form.qty),
      type: form.type,
      src_location: form.src_location,
      dst_location: form.dst_location,
      notes: form.notes,
      user: 'admin'
    });
    setForm({ type: 'stock-in', product_id: '', qty: '', src_location: '', dst_location: '', notes: '' });
    await loadData();
    setSaving(false);
  };

  const productMap = products.reduce((acc, item) => ({ ...acc, [item.id]: item.name }), {});
  const locationMap = locations.reduce((acc, item) => ({ ...acc, [item.id]: item.name }), {});
  const showSrc = form.type === 'stock-out' || form.type === 'transfer' || form.type === 'adjustment';
  const showDst = form.type === 'stock-in' || form.type === 'transfer' || form.type === 'adjustment';

  return (
    <AdminLayout title="Stock Movement" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>New stock movement</Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <FormControl fullWidth>
            <InputLabel>Movement type</InputLabel>
            <Select value={form.type} label="Movement type" onChange={e => setForm({ ...form, type: e.target.value })}>
              <MenuItem value="stock-in">Stock In</MenuItem>
              <MenuItem value="stock-out">Stock Out</MenuItem>
              <MenuItem value="transfer">Transfer</MenuItem>
              <MenuItem value="adjustment">Adjustment</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Product</InputLabel>
            <Select value={form.product_id} label="Product" onChange={e => setForm({ ...form, product_id: e.target.value })}>
              {products.map(product => (
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
                {locations.map(loc => <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {showDst && (
            <FormControl fullWidth>
              <InputLabel>Destination location</InputLabel>
              <Select value={form.dst_location} label="Destination location" onChange={e => setForm({ ...form, dst_location: e.target.value })}>
                <MenuItem value="">None</MenuItem>
                {locations.map(loc => <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          <TextField label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} multiline rows={2} fullWidth />
          <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.product_id || !form.qty}>Submit movement</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" mb={2}>Recent stock movements</Typography>
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
            ) : movements.length === 0 ? (
              <TableRow><TableCell colSpan={6}>No stock movements found.</TableCell></TableRow>
            ) : movements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell>{movement.type}</TableCell>
                <TableCell>{productMap[movement.product_id] ?? movement.product_id}</TableCell>
                <TableCell>{movement.qty}</TableCell>
                <TableCell>{locationMap[movement.src_location] ?? movement.src_location || '-'}</TableCell>
                <TableCell>{locationMap[movement.dst_location] ?? movement.dst_location || '-'}</TableCell>
                <TableCell>{new Date(movement.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Paper sx={{ p: 3, mt: 3 }}>
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
            ) : lots.length === 0 ? (
              <TableRow><TableCell colSpan={4}>No lot data available.</TableCell></TableRow>
            ) : lots.map(lot => (
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
    </AdminLayout>
  );
}

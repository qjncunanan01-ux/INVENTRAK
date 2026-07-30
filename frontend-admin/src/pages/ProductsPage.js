import { Box, Button, Dialog, DialogActions, DialogTitle, Grid, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function ProductsPage({ onLogout }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
  const [saving, setSaving] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);

  const loadProducts = () => {
    setLoading(true);
    apiGet('/api/products')
      .then(r => setProducts(r.data || r))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, []);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await apiDelete(`/api/products/${confirmDelete}`);
      if (editingProductId === confirmDelete) {
        setEditingProductId(null);
        setForm({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
      }
      setSnackbar({ open: true, message: 'Product deleted', severity: 'success' });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
      setConfirmDelete(null);
    }
  };

  const handleEdit = (product) => {
    setEditingProductId(product.id);
    setForm({
      name: product.name || '',
      category: product.category || '',
      brand: product.brand || '',
      size: product.size || '',
      unit: product.unit || '',
      price: product.price?.toString() || ''
    });
  };

  const handleCreate = async () => {
    if (!form.name || !form.category) {
      setSnackbar({ open: true, message: 'Name and category are required', severity: 'warning' });
      return;
    }
    if (parseFloat(form.price) < 0) {
      setSnackbar({ open: true, message: 'Price cannot be negative', severity: 'warning' });
      return;
    }
    setSaving(true);
    try {
      if (editingProductId) {
        await apiPut(`/api/products/${editingProductId}`, {
          name: form.name, category: form.category, brand: form.brand,
          size: form.size, unit: form.unit, price: parseFloat(form.price) || 0, status: 'active'
        });
        setEditingProductId(null);
        setSnackbar({ open: true, message: 'Product updated', severity: 'success' });
      } else {
        await apiPost('/api/products', {
          name: form.name, category: form.category, brand: form.brand,
          size: form.size, unit: form.unit, price: parseFloat(form.price) || 0, status: 'active'
        });
        setSnackbar({ open: true, message: 'Product created', severity: 'success' });
      }
      setForm({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const prodList = Array.isArray(products) ? products : [];

  return (
    <AdminLayout title="Product Management" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Product catalog controls</Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Add, edit, and manage product details for inventory tracking.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField fullWidth variant="outlined" label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Grid>
          <Grid item xs={12} md={4}><TextField fullWidth variant="outlined" label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></Grid>
          <Grid item xs={12} md={4}><TextField fullWidth variant="outlined" label="Brand" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} /></Grid>
          <Grid item xs={12} sm={6} md={3}><TextField fullWidth variant="outlined" label="Size" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} /></Grid>
          <Grid item xs={12} sm={6} md={3}><TextField fullWidth variant="outlined" label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></Grid>
          <Grid item xs={12} sm={6} md={3}><TextField fullWidth variant="outlined" label="Price" type="number" inputProps={{ min: 0 }} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></Grid>
          <Grid item xs={12} sm={6} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
            <Button variant="contained" fullWidth onClick={handleCreate} disabled={saving || !form.name || !form.category}>
              {editingProductId ? 'Save product' : 'Create product'}
            </Button>
          </Grid>
          {editingProductId ? (
            <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button variant="outlined" fullWidth onClick={() => { setEditingProductId(null); setForm({ name: '', category: '', brand: '', size: '', unit: '', price: '' }); }}>
                Cancel edit
              </Button>
            </Grid>
          ) : null}
        </Grid>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">Active products</Typography>
          <Typography variant="body2" color="text.secondary">Total {prodList.length}</Typography>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Size</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Brand</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading...</TableCell></TableRow>
            ) : prodList.length === 0 ? (
              <TableRow><TableCell colSpan={6}>No products found</TableCell></TableRow>
            ) : prodList.map(product => (
              <TableRow key={product.id}>
                <TableCell>{product.name}</TableCell>
                <TableCell>{product.category}</TableCell>
                <TableCell>{product.size}</TableCell>
                <TableCell>{product.price}</TableCell>
                <TableCell>{product.brand}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => handleEdit(product)}>Edit</Button>
                    <Button size="small" variant="contained" color="error" onClick={() => setConfirmDelete(product.id)}>Delete</Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete this product? This action cannot be undone.</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

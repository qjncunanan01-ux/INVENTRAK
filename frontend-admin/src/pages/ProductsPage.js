import { Box, Button, Grid, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function ProductsPage({ onLogout }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
  const [saving, setSaving] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);

  const loadProducts = () => {
    setLoading(true);
    axios.get(`${API_BASE_URL}/api/products`)
      .then(r => setProducts(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleDelete = async (id) => {
    setSaving(true);
    try {
      await axios.delete(`${API_BASE_URL}/api/products/${id}`);
      if (editingProductId === id) {
        setEditingProductId(null);
        setForm({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
      }
      loadProducts();
    } finally {
      setSaving(false);
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
    setSaving(true);
    try {
      if (editingProductId) {
        await axios.put(`${API_BASE_URL}/api/products/${editingProductId}`, {
          name: form.name,
          category: form.category,
          brand: form.brand,
          size: form.size,
          unit: form.unit,
          price: parseFloat(form.price) || 0,
          status: 'active'
        });
        setEditingProductId(null);
      } else {
        await axios.post(`${API_BASE_URL}/api/products`, {
          name: form.name,
          category: form.category,
          brand: form.brand,
          size: form.size,
          unit: form.unit,
          price: parseFloat(form.price) || 0,
          status: 'active'
        });
      }
      setForm({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
      loadProducts();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="Product Management" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>Add new product</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField fullWidth label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Grid>
          <Grid item xs={12} md={4}><TextField fullWidth label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></Grid>
          <Grid item xs={12} md={4}><TextField fullWidth label="Brand" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} /></Grid>
          <Grid item xs={6} md={3}><TextField fullWidth label="Size" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} /></Grid>
          <Grid item xs={6} md={3}><TextField fullWidth label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></Grid>
          <Grid item xs={6} md={3}><TextField fullWidth label="Price" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></Grid>
          <Grid item xs={6} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
            <Button variant="contained" fullWidth onClick={handleCreate} disabled={saving || !form.name || !form.category}>
              {editingProductId ? 'Save product' : 'Create product'}
            </Button>
          </Grid>
          {editingProductId ? (
            <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button variant="outlined" fullWidth onClick={() => {
                setEditingProductId(null);
                setForm({ name: '', category: '', brand: '', size: '', unit: '', price: '' });
              }}>
                Cancel edit
              </Button>
            </Grid>
          ) : null}
        </Grid>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Active products</Typography>
          <Typography variant="body2">Total {products.length}</Typography>
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
            ) : products.length === 0 ? (
              <TableRow><TableCell colSpan={6}>No products found</TableCell></TableRow>
            ) : products.map(product => (
              <TableRow key={product.id}>
                <TableCell>{product.name}</TableCell>
                <TableCell>{product.category}</TableCell>
                <TableCell>{product.size}</TableCell>
                <TableCell>{product.price}</TableCell>
                <TableCell>{product.brand}</TableCell>
                <TableCell>
                <Button size="small" onClick={() => handleEdit(product)}>Edit</Button>
                <Button size="small" color="error" onClick={() => handleDelete(product.id)}>Delete</Button>
              </TableCell>
            </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}

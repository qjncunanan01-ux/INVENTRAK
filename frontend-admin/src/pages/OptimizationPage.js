import { Box, Card, CardContent, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function OptimizationPage({ onLogout }) {
  const [abc, setAbc] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const [abcRes, productsRes] = await Promise.all([
      axios.get(`${API_BASE_URL}/api/optimization/abc`),
      axios.get(`${API_BASE_URL}/api/products`)
    ]);
    setAbc(abcRes.data);
    setProducts(productsRes.data);
    if (productsRes.data.length) setSelectedProductId(productsRes.data[0].id.toString());
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    axios.get(`${API_BASE_URL}/api/optimization/${selectedProductId}`).then(r => setMetrics(r.data));
  }, [selectedProductId]);

  return (
    <AdminLayout title="Inventory Optimization" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>ABC Classification</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Classification</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={3}>Loading...</TableCell></TableRow>
            ) : abc.length === 0 ? (
              <TableRow><TableCell colSpan={3}>No optimization data available</TableCell></TableRow>
            ) : abc.map(item => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.value}</TableCell>
                <TableCell>{item.classification}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <FormControl sx={{ minWidth: 240 }}>
            <InputLabel>Product</InputLabel>
            <Select value={selectedProductId} label="Product" onChange={e => setSelectedProductId(e.target.value)}>
              {products.map(product => (
                <MenuItem key={product.id} value={product.id.toString()}>{product.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        {metrics ? (
          <Card>
            <CardContent>
              <Typography variant="h6" mb={1}>Economic Order Quantity</Typography>
              <Typography>EOQ: {metrics.EOQ}</Typography>
              <Typography>Reorder Point: {metrics.ROP}</Typography>
              <Typography>Safety Stock: {metrics.safetyStock}</Typography>
            </CardContent>
          </Card>
        ) : (
          <Typography>Select a product to view EOQ, ROP, and safety stock metrics.</Typography>
        )}
      </Paper>
    </AdminLayout>
  );
}

import { Box, Card, CardContent, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function OptimizationPage({ onLogout }) {
  const [abc, setAbc] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [abcRes, productsRes] = await Promise.all([
        apiGet('/api/optimization/abc'),
        apiGet('/api/products')
      ]);
      const abcData = abcRes.data || abcRes;
      const prodData = productsRes.data || productsRes;
      setAbc(abcData);
      setProducts(prodData);
      if (prodData.length) setSelectedProductId(prodData[0].id.toString());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    apiGet(`/api/optimization/${selectedProductId}`)
      .then(r => setMetrics(r.data || r))
      .catch(() => setMetrics(null));
  }, [selectedProductId]);

  const abcList = (Array.isArray(abc) ? abc : []).filter(item => {
    const q = search.trim().toLowerCase();
    return !q || (item.name || '').toLowerCase().includes(q) || (item.classification || '').toLowerCase().includes(q);
  });
  const prodList = Array.isArray(products) ? products : [];

  const getClassificationColor = (cls) => {
    if (cls === 'A') return 'error';
    if (cls === 'B') return 'warning';
    return 'success';
  };

  return (
    <AdminLayout title="Inventory Optimization" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">ABC Classification</Typography>
            <Typography variant="body2" color="text.secondary">
              View product classification and prioritize inventory decisions.
            </Typography>
          </div>
          <TextField
            size="small"
            label="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 220, backgroundColor: colors.surface }}
          />
        </Box>
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
              <TableRow><TableCell colSpan={3}>Loading…</TableCell></TableRow>
            ) : abcList.length === 0 ? (
              <TableRow><TableCell colSpan={3}>No optimization data available</TableCell></TableRow>
            ) : abcList.map(item => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.value}</TableCell>
                <TableCell>
                  <Chip label={item.classification} color={getClassificationColor(item.classification)} size="small" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <FormControl sx={{ minWidth: 240 }}>
            <InputLabel>Product</InputLabel>
            <Select value={selectedProductId} label="Product" onChange={e => setSelectedProductId(e.target.value)}>
              {prodList.map(product => (
                <MenuItem key={product.id} value={product.id.toString()}>{product.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        {metrics ? (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Card sx={{ flex: 1, minWidth: 200, backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Economic Order Quantity</Typography>
                <Typography variant="h5">{metrics.EOQ}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, minWidth: 200, backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Reorder Point</Typography>
                <Typography variant="h5">{metrics.ROP}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, minWidth: 200, backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Safety Stock</Typography>
                <Typography variant="h5">{metrics.safetyStock}</Typography>
              </CardContent>
            </Card>
          </Box>
        ) : (
          <Typography>Select a product to view EOQ, ROP, and safety stock metrics.</Typography>
        )}

        {metrics && metrics.turnoverRatio !== undefined && (
          <Box sx={{ mt: 2 }}>
            <Card sx={{ backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Inventory Turnover Ratio</Typography>
                <Typography variant="h5">{metrics.turnoverRatio.toFixed(2)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Avg Inventory: {metrics.avgInventory} | Annual Demand: {metrics.annualDemand}
                </Typography>
              </CardContent>
            </Card>
          </Box>
        )}

        {metrics && metrics.forecast !== undefined && (
          <Box sx={{ mt: 2 }}>
            <Card sx={{ backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Demand Forecast (Next Month)</Typography>
                <Typography variant="h5">{metrics.forecast}</Typography>
              </CardContent>
            </Card>
          </Box>
        )}
      </Paper>
    </AdminLayout>
  );
}

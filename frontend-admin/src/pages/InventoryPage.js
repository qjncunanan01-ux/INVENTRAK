import { Box, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function InventoryPage({ onLogout }) {
  const [inventory, setInventory] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (lowStockOnly) params.set('low_stock', 'true');
    if (selectedLocation) params.set('location', selectedLocation);
    const qs = params.toString();

    apiGet(`/api/inventory${qs ? '?' + qs : ''}`)
      .then(r => {
        const data = r.data || r;
        setInventory(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lowStockOnly, selectedLocation]);

  const locs = (inventory.locations || []).map(loc => (typeof loc === 'object' ? loc : { id: loc, name: loc }));
  const items = (inventory.items || []).filter(item => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (item.product?.name || '').toLowerCase().includes(q) ||
      (item.product?.category || '').toLowerCase().includes(q);
  });

  return (
    <AdminLayout title="Inventory Management" onLogout={onLogout}>
      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">Inventory levels</Typography>
            <Typography variant="body2" color="text.secondary">Track stock distribution across locations.</Typography>
          </div>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              label="Search products..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 220, backgroundColor: colors.surface }}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Location</InputLabel>
              <Select value={selectedLocation} label="Location" onChange={e => setSelectedLocation(e.target.value)}>
                <MenuItem value="">All locations</MenuItem>
                {locs.map(loc => <MenuItem key={loc.name} value={loc.name}>{loc.name}</MenuItem>)}
              </Select>
            </FormControl>
            <Chip
              label={lowStockOnly ? 'Showing low stock' : 'All items'}
              color={lowStockOnly ? 'warning' : 'default'}
              onClick={() => setLowStockOnly(!lowStockOnly)}
              variant={lowStockOnly ? 'filled' : 'outlined'}
            />
            <Typography variant="subtitle2" color="text.secondary">{locs.length} locations</Typography>
          </Box>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              {locs.map(loc => <TableCell key={loc.name}>{loc.name}</TableCell>)}
              <TableCell>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={locs.length + 2}>Loading...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={locs.length + 2}>No inventory data</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.product.id} sx={{
                backgroundColor: item.total < 80 ? 'rgba(249,168,37,0.08)' : 'inherit'
              }}>
                <TableCell>
                  {item.product.name}
                  {item.total < 80 && <Chip label="Low" size="small" color="warning" sx={{ ml: 1 }} />}
                </TableCell>
                {locs.map(loc => <TableCell key={loc.name}>{item.locations[loc.name] ?? 0}</TableCell>)}
                <TableCell><strong>{item.total}</strong></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}

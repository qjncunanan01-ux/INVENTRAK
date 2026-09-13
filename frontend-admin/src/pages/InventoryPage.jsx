import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import usePageTitle from '../hooks/usePageTitle';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

// Status badge per inventory row. The backend stamps each item with its
// movement-aware critical_level (critical-level.js) + a stock_status badge;
// older payloads without those fields fall back to the legacy flat 80 bar.
const STATUS_META = {
  out_of_stock: { label: 'Out of Stock', color: 'error' },
  critical: { label: 'Critical', color: 'error' },
  low_stock: { label: 'Low Stock', color: 'warning' },
  in_stock: { label: 'In Stock', color: 'success' },
};

function statusFor(item) {
  const total = Number(item.total) || 0;
  const level = Number(item.critical_level);
  if (Number.isFinite(level) && level > 0) {
    if (total <= 0) return 'out_of_stock';
    if (total <= level) return 'critical';
    if (total <= Math.ceil(level * 1.5)) return 'low_stock';
    return 'in_stock';
  }
  return total < 80 ? 'low_stock' : 'in_stock';
}

export default function InventoryPage({ onLogout }) {
  usePageTitle('/inventory');
  const [inventory, setInventory] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [search, setSearch] = useState('');

  // Scan-to-stock deep link: a scanned product QR opens /inventory?product=<id>
  // and a scanned location tag opens /inventory?location=<name>. Both simply
  // pre-apply the existing filters, so the operator lands on the exact view.
  const [searchParams] = useSearchParams();
  const [focusProductId, setFocusProductId] = useState(null);

  useEffect(() => {
    const loc = searchParams.get('location');
    const product = searchParams.get('product');
    if (loc) setSelectedLocation(loc);
    if (product && Number.isFinite(Number(product))) setFocusProductId(Number(product));
  }, [searchParams]);

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
    if (focusProductId !== null && Number(item.product?.id ?? item.id) !== focusProductId) return false;
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
            <Button
              component={RouterLink}
              to="/scan-stock"
              size="small"
              variant="contained"
              startIcon={<CameraAltOutlined />}
              sx={{ backgroundColor: colors.brandPrimary }}
            >
              Scan & Stock
            </Button>
            <TextField
              size="small"
              label="Search products…"
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
            <FormControl size="small" sx={{ minWidth: 150, backgroundColor: colors.surface }}>
              <InputLabel>Stock level</InputLabel>
              <Select value={lowStockOnly ? 'low' : ''} label="Stock level" onChange={e => setLowStockOnly(e.target.value === 'low')}>
                <MenuItem value="">All items</MenuItem>
                <MenuItem value="low">Low stock only</MenuItem>
              </Select>
            </FormControl>
            {focusProductId !== null ? (
              <Chip
                color="primary"
                label={`Scanned product #${focusProductId} — clear`}
                onDelete={() => setFocusProductId(null)}
                aria-label={`Showing only the scanned product ${focusProductId}. Clear filter.`}
              />
            ) : null}
            <Typography variant="subtitle2" color="text.secondary">{locs.length} locations</Typography>
          </Box>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              {locs.map(loc => <TableCell key={loc.name}>{loc.name}</TableCell>)}
              <TableCell>Total</TableCell>
              <TableCell>Critical Level</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={locs.length + 4}>Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={locs.length + 4}>No inventory data</TableCell></TableRow>
            ) : items.map(item => {
              const status = statusFor(item);
              const meta = STATUS_META[status];
              const below = status === 'critical' || status === 'low_stock';
              return (
                <TableRow key={item.product.id} sx={{
                  backgroundColor: below ? 'rgba(249,168,37,0.08)' : 'inherit'
                }}>
                  <TableCell>{item.product.name}</TableCell>
                  {locs.map(loc => <TableCell key={loc.name}>{item.locations[loc.name] ?? 0}</TableCell>)}
                  <TableCell><strong>{item.total}</strong></TableCell>
                  <TableCell>{item.critical_level ?? 80}</TableCell>
                  <TableCell>
                    <Chip label={meta.label} size="small" color={meta.color} variant={status === 'in_stock' ? 'outlined' : 'filled'} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}

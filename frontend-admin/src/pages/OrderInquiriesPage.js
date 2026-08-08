import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const STATUS_COLORS = {
  pending: 'warning',
  approved: 'info',
  fulfilled: 'success',
  delivered: 'success',
  rejected: 'error',
};

const STATUS_FILTERS = [
  { key: '', label: 'All statuses' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'rejected', label: 'Rejected' },
];

// Parse an order's stored products JSON into an array of line items.
// Handles the structured lines ({ name, qty, price, original_price, ... })
// the app now records AND legacy plain-string entries ('Widget x2').
function parseLines(order) {
  if (Array.isArray(order.products_detail)) return order.products_detail;
  try {
    const parsed = JSON.parse(order.products || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// One line's price (unit price actually charged — deal price when discounted).
// Prefers the normalized unit_price, falls back to the raw request price.
function linePrice(line) {
  const p = Number(line.unit_price ?? line.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

function lineOriginal(line) {
  const p = Number(line.original_price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// Render the line items of one order: name x qty, with the price actually
// charged and — when the item was a flash-sale deal — the struck-through
// original price + savings so the admin sees the discount applied at a glance.
function renderLineItems(lines) {
  if (!lines || lines.length === 0) return '—';
  return lines.map((line) => {
    if (typeof line === 'string') return line;
    const name = line.name || 'Item';
    const qty = Number(line.qty) > 1 ? ` x${line.qty}` : '';
    const price = linePrice(line);
    const original = lineOriginal(line);
    const isDeal = price !== null && original !== null && original > price;
    const savings = isDeal ? ((original - price) / original) * 100 : 0;
    return (
      <Box key={`${name}-${qty}-${price}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" component="span">
          {name}{qty}
        </Typography>
        {isDeal ? (
          <>
            <Typography variant="body2" component="span" sx={{ color: '#e23744', fontWeight: 700 }}>
              P{price}
            </Typography>
            <Typography variant="caption" component="span" sx={{ color: '#9aa0a6', textDecoration: 'line-through' }}>
              P{original}
            </Typography>
            <Chip label={`-${Math.round(savings)}%`} size="small" sx={{ height: 18, backgroundColor: '#ffe3dd', color: '#e23744', fontWeight: 800, fontSize: '0.65rem' }} />
          </>
        ) : price !== null ? (
          <Typography variant="body2" component="span" sx={{ color: colors.brandPrimary, fontWeight: 600 }}>
            P{price}
          </Typography>
        ) : null}
      </Box>
    );
  });
}

// Plain-text lines for the search filter (works for both line shapes).
function linesToText(lines) {
  return lines.map((line) => {
    if (typeof line === 'string') return line;
    return `${line.name || ''} x${line.qty || 1}`;
  }).join(' ');
}

export default function OrderInquiriesPage({ onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, id: null, status: '' });
  const [details, setDetails] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadOrders = () => {
    setLoading(true);
    apiGet('/api/order-inquiries')
      .then(r => setOrders(r.data || r))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadOrders(); }, []);

  const handleConfirmAction = (orderId, status) => {
    setConfirmDialog({ open: true, id: orderId, status });
  };

  const executeAction = async () => {
    try {
      await apiPut(`/api/order-inquiries/${confirmDialog.id}`, { status: confirmDialog.status });
      setSnackbar({ open: true, message: `Order marked ${confirmDialog.status}`, severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setConfirmDialog({ open: false, id: null, status: '' });
    }
  };

  // Pending count drives an urgency chip in the header: work waiting in the
  // queue, at a glance.
  const pendingCount = (Array.isArray(orders) ? orders : []).filter(o => o.status === 'pending').length;

  // Status dropdown filter (combined with the search bar): 'All statuses'
  // shows everything; a specific status narrows first, then the text search
  // runs on the remaining rows.
  const orderList = (Array.isArray(orders) ? orders : []).filter(order => {
    if (statusFilter && order.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const productsText = linesToText(parseLines(order)).toLowerCase();
    return (order.customer_name || '').toLowerCase().includes(q) ||
      (order.customer_email || '').toLowerCase().includes(q) ||
      (order.status || '').toLowerCase().includes(q) ||
      (order.payment_method || '').toLowerCase().includes(q) ||
      productsText.toLowerCase().includes(q);
  });

  const renderActions = (order) => {
    if (order.status === 'pending') {
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" variant="contained" color="secondary" startIcon={<span>✓</span>} onClick={() => handleConfirmAction(order.id, 'approved')}>Approve</Button>
          <Button size="small" variant="contained" color="error" startIcon={<span>✕</span>} onClick={() => handleConfirmAction(order.id, 'rejected')}>Reject</Button>
        </Box>
      );
    }
    if (order.status === 'approved') {
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" variant="contained" color="success" startIcon={<span>📦</span>} onClick={() => handleConfirmAction(order.id, 'fulfilled')}>Mark Fulfilled</Button>
          <Button size="small" variant="outlined" color="error" onClick={() => handleConfirmAction(order.id, 'rejected')}>Reject</Button>
        </Box>
      );
    }
    if (order.status === 'fulfilled') {
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" variant="contained" color="success" startIcon={<span>🏠</span>} onClick={() => handleConfirmAction(order.id, 'delivered')}>Mark Delivered</Button>
          <Button size="small" variant="outlined" onClick={() => setDetails(order)}>Details</Button>
        </Box>
      );
    }
    if (order.status === 'delivered') {
      return <Chip label="✓ Delivered" color="success" size="small" variant="outlined" />;
    }
    return <Chip label="Rejected" color="error" size="small" variant="outlined" />;
  };

  return (
    <AdminLayout title="Order Inquiries" onLogout={onLogout}>
      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">Submitted order inquiries</Typography>
            <Typography variant="body2" color="text.secondary">
              Review incoming customer requests and update status: Pending → Approved → Fulfilled → Delivered.
            </Typography>
          </div>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160, backgroundColor: colors.surface }}>
              <InputLabel>Status</InputLabel>
              <Select value={statusFilter} label="Status" onChange={e => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map(f => <MenuItem key={f.key || 'all'} value={f.key}>{f.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Search customer / email / status..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 260, backgroundColor: colors.surface }}
            />
            {pendingCount > 0 && (
              <Chip
                label={`${pendingCount} pending`}
                color="warning"
                size="small"
                sx={{ fontWeight: 700 }}
              />
            )}
            <Typography variant="subtitle2" color="text.secondary">{orderList.length} inquiries</Typography>
          </Box>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Customer</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Products</TableCell>
              <TableCell>Estimated Cost</TableCell>
              <TableCell>Delivery & Payment</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8}>Loading...</TableCell></TableRow>
            ) : orderList.length === 0 ? (
              <TableRow><TableCell colSpan={8}>No order inquiries</TableCell></TableRow>
            ) : orderList.map(order => {
              const lines = parseLines(order);
              return (
                <TableRow key={order.id} sx={{ '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' } }}>
                  <TableCell>{order.customer_name}</TableCell>
                  <TableCell>{order.customer_email}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    {renderLineItems(lines)}
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }}>P{order.estimated_cost}</Typography>
                    {lines.some((l) => {
                      if (typeof l === 'string') return false;
                      const orig = lineOriginal(l);
                      const price = linePrice(l);
                      return orig !== null && price !== null && orig > price;
                    }) && (
                      <Chip label="includes flash deals" size="small" sx={{ mt: 0.5, height: 18, backgroundColor: '#ffe3dd', color: '#e23744', fontWeight: 700, fontSize: '0.65rem' }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip size="small" label={(order.payment_method || 'cod').toUpperCase()} color={order.payment_method === 'gcash' ? 'info' : 'default'} />
                      {order.payment_status === 'paid' && <Chip size="small" label="PAID" color="success" />}
                      {order.payment_status === 'unpaid' && order.payment_method !== 'cod' && <Chip size="small" label="UNPAID" variant="outlined" />}
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {order.delivery_address || '—'}
                      {order.payment_reference ? ` · ${order.payment_reference}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={order.status} color={STATUS_COLORS[order.status] || 'default'} size="small" />
                  </TableCell>
                  <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{renderActions(order)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ open: false, id: null, status: '' })}>
        <DialogTitle>Confirm action: mark this inquiry as "{confirmDialog.status}"?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The customer will be notified by email{/* (and SMS when a phone was provided) */} of the status change.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ open: false, id: null, status: '' })}>Cancel</Button>
          <Button onClick={executeAction} variant="contained" color="primary">Confirm</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={details !== null} onClose={() => setDetails(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Order details</DialogTitle>
        <DialogContent dividers>
          {details && (
            <Box>
              <Typography variant="subtitle2">Customer</Typography>
              <Typography variant="body2" mb={1}>{details.customer_name} · {details.customer_email} · {details.customer_phone || 'no phone'}</Typography>
              <Typography variant="subtitle2">Products</Typography>
              <Box mb={1}>
                {renderLineItems(parseLines(details))}
              </Box>
              <Typography variant="subtitle2">Cost</Typography>
              <Typography variant="body2" mb={1}>P{details.estimated_cost} ({details.payment_method?.toUpperCase()} · {details.payment_status || 'unpaid'})</Typography>
              <Typography variant="subtitle2">Delivery address</Typography>
              <Typography variant="body2" mb={1}>{details.delivery_address || '—'}</Typography>
              {details.payment_reference && (
                <>
                  <Typography variant="subtitle2">Payment reference</Typography>
                  <Typography variant="body2" mb={1}>{details.payment_reference}</Typography>
                </>
              )}
              <Typography variant="subtitle2">Notes</Typography>
              <Typography variant="body2">{details.notes || '—'}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetails(null)}>Close</Button>
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

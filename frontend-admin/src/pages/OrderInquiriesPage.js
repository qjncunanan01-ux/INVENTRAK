import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
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

export default function OrderInquiriesPage({ onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, id: null, status: '' });
  const [details, setDetails] = useState(null);

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

  const orderList = Array.isArray(orders) ? orders : [];

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
          <Typography variant="subtitle2" color="text.secondary">{orderList.length} inquiries</Typography>
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
              let products = [];
              try { products = JSON.parse(order.products); } catch (err) { products = [order.products]; }
              return (
                <TableRow key={order.id} sx={{ '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' } }}>
                  <TableCell>{order.customer_name}</TableCell>
                  <TableCell>{order.customer_email}</TableCell>
                  <TableCell>{Array.isArray(products) ? products.join(', ') : products}</TableCell>
                  <TableCell>P{order.estimated_cost}</TableCell>
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
              <Typography variant="body2" mb={1}>{details.products}</Typography>
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

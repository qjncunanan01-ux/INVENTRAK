import { Box, Button, Dialog, DialogActions, DialogTitle, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function OrderInquiriesPage({ onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, id: null, status: '' });

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
      setSnackbar({ open: true, message: `Order ${confirmDialog.status} successfully`, severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setConfirmDialog({ open: false, id: null, status: '' });
    }
  };

  const orderList = Array.isArray(orders) ? orders : [];

  return (
    <AdminLayout title="Order Inquiries" onLogout={onLogout}>
      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">Submitted order inquiries</Typography>
            <Typography variant="body2" color="text.secondary">Review incoming customer requests and update inquiry status.</Typography>
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
              <TableCell>Status</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7}>Loading...</TableCell></TableRow>
            ) : orderList.length === 0 ? (
              <TableRow><TableCell colSpan={7}>No order inquiries</TableCell></TableRow>
            ) : orderList.map(order => {
              let products = [];
              try { products = JSON.parse(order.products); } catch (err) { products = [order.products]; }
              return (
                <TableRow key={order.id}>
                  <TableCell>{order.customer_name}</TableCell>
                  <TableCell>{order.customer_email}</TableCell>
                  <TableCell>{Array.isArray(products) ? products.join(', ') : products}</TableCell>
                  <TableCell>P{order.estimated_cost}</TableCell>
                  <TableCell>{order.status}</TableCell>
                  <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {order.status === 'pending' && (
                        <>
                          <Button size="small" variant="contained" color="secondary" onClick={() => handleConfirmAction(order.id, 'approved')}>Approve</Button>
                          <Button size="small" variant="contained" color="error" onClick={() => handleConfirmAction(order.id, 'rejected')}>Reject</Button>
                        </>
                      )}
                      {order.status === 'approved' && (
                        <>
                          <Button size="small" variant="contained" color="success" onClick={() => handleConfirmAction(order.id, 'fulfilled')}>Fulfill</Button>
                          <Button size="small" variant="contained" color="error" onClick={() => handleConfirmAction(order.id, 'rejected')}>Reject</Button>
                        </>
                      )}
                      {(order.status === 'fulfilled' || order.status === 'rejected') && (
                        <Typography variant="body2" color="text.secondary">No actions</Typography>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ open: false, id: null, status: '' })}>
        <DialogTitle>Confirm action: {confirmDialog.status} this inquiry?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ open: false, id: null, status: '' })}>Cancel</Button>
          <Button onClick={executeAction} variant="contained" color="primary">Confirm</Button>
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

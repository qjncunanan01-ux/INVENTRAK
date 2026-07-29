import { Button, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function OrderInquiriesPage({ onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = () => {
    setLoading(true);
    axios.get(`${API_BASE_URL}/api/order-inquiries`)
      .then(r => setOrders(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const updateStatus = async (orderId, status) => {
    await axios.put(`${API_BASE_URL}/api/order-inquiries/${orderId}`, { status });
    loadOrders();
  };

  return (
    <AdminLayout title="Order Inquiries" onLogout={onLogout}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" mb={2}>Submitted order inquiries</Typography>
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
            ) : orders.length === 0 ? (
              <TableRow><TableCell colSpan={7}>No order inquiries</TableCell></TableRow>
            ) : orders.map(order => {
              let products = [];
              try { products = JSON.parse(order.products); } catch (err) { products = [order.products]; }
              return (
                <TableRow key={order.id}>
                  <TableCell>{order.customer_name}</TableCell>
                  <TableCell>{order.customer_email}</TableCell>
                  <TableCell>{Array.isArray(products) ? products.join(', ') : products}</TableCell>
                  <TableCell>₱{order.estimated_cost}</TableCell>
                  <TableCell>
                    {order.status}
                  </TableCell>
                  <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {order.status === 'pending' && (
                      <>
                        <Button size="small" onClick={() => updateStatus(order.id, 'approved')}>Approve</Button>
                        <Button size="small" color="error" onClick={() => updateStatus(order.id, 'rejected')}>Reject</Button>
                      </>
                    )}
                    {order.status === 'approved' && (
                      <>
                        <Button size="small" onClick={() => updateStatus(order.id, 'fulfilled')}>Fulfill</Button>
                        <Button size="small" color="error" onClick={() => updateStatus(order.id, 'rejected')}>Reject</Button>
                      </>
                    )}
                    {(order.status === 'fulfilled' || order.status === 'rejected') && (
                      <Typography variant="body2" color="text.secondary">No actions</Typography>
                    )}
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

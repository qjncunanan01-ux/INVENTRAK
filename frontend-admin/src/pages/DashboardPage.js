import { Box, Grid, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function DashboardPage({ user, onLogout }) {
  const [summary, setSummary] = useState({ totalProducts: 0, totalStock: 0, lowStock: 0, totalLocations: 0, pendingInquiries: 0, recentMovements: [] });

  useEffect(() => {
    const load = async () => {
      const [productsRes, inventoryRes, movementsRes, locationsRes, ordersRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/products`),
        axios.get(`${API_BASE_URL}/api/inventory`),
        axios.get(`${API_BASE_URL}/api/stock-movements`),
        axios.get(`${API_BASE_URL}/api/locations`),
        axios.get(`${API_BASE_URL}/api/order-inquiries`)
      ]);
      const totalProducts = productsRes.data.length;
      const totalStock = inventoryRes.data.items.reduce((sum, item) => sum + item.total, 0);
      const lowStock = inventoryRes.data.items.filter(item => item.total < 80).length;
      const totalLocations = locationsRes.data.length;
      const pendingInquiries = ordersRes.data.filter(order => order.status === 'pending').length;
      setSummary({ totalProducts, totalStock, lowStock, totalLocations, pendingInquiries, recentMovements: movementsRes.data.slice(0, 4) });
    };
    load();
  }, []);

  return (
    <AdminLayout title="Admin Dashboard" onLogout={onLogout}>
      <Typography sx={{ mb: 2 }}>Welcome back, {user.username}</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Inventory Overview</Typography>
            <List>
              <ListItem><ListItemText primary="Total products" secondary={summary.totalProducts} /></ListItem>
              <ListItem><ListItemText primary="Total inventory" secondary={summary.totalStock} /></ListItem>
              <ListItem><ListItemText primary="Low stock items" secondary={summary.lowStock} /></ListItem>
              <ListItem><ListItemText primary="Locations" secondary={summary.totalLocations} /></ListItem>
              <ListItem><ListItemText primary="Pending inquiries" secondary={summary.pendingInquiries} /></ListItem>
            </List>
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, minHeight: 220 }}>
            <Typography variant="h6">Recent stock movements</Typography>
            <Box mt={2}>
              {summary.recentMovements.length === 0 ? (
                <Typography>No movements yet.</Typography>
              ) : summary.recentMovements.map(m => (
                <Box key={m.id} sx={{ mb: 1 }}>
                  <Typography><strong>{m.type}</strong> product {m.product_id} on {new Date(m.created_at).toLocaleDateString()}</Typography>
                  <Typography variant="body2">Qty: {m.qty} | From: {m.src_location || '-'} | To: {m.dst_location || '-'}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </AdminLayout>
  );
}

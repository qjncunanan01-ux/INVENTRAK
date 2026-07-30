import { Box, Chip, Grid, Paper, Snackbar, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const CHART_COLORS = ['#1f640e', '#a8d22b', '#e9ffd5', '#4caf50', '#81c784', '#c8e6c9'];

export default function DashboardPage({ user, onLogout }) {
  const [summary, setSummary] = useState({
    totalProducts: 0, totalStock: 0, lowStockItems: 0, totalLocations: 0,
    pendingInquiries: 0, totalSales: 0, totalMovements: 0, activeAlerts: 0,
    topProducts: [], monthlyMovements: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiGet('/api/analytics/summary');
        setSummary(data);
      } catch (err) {
        setError('Failed to load dashboard data. Make sure the backend is running.');
        setSnackbar({ open: true, message: err.message });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const productValueData = summary.topProducts.map(p => ({
    name: p.name?.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
    value: Math.round(p.stock_value)
  }));

  const movementTypes = {};
  summary.monthlyMovements.forEach(m => {
    if (!movementTypes[m.month]) movementTypes[m.month] = {};
    movementTypes[m.month][m.type] = m.count;
  });
  const movementChartData = Object.entries(movementTypes).slice(0, 6).map(([month, types]) => ({
    month,
    'stock-in': types['stock-in'] || 0,
    'stock-out': types['stock-out'] || 0,
    transfer: types.transfer || 0,
    adjustment: types.adjustment || 0,
  }));

  const panels = [
    { label: 'Total products', value: summary.totalProducts, color: colors.brandPrimary },
    { label: 'Total inventory', value: summary.totalStock.toLocaleString(), color: colors.info },
    { label: 'Low stock items', value: summary.lowStockItems, color: summary.lowStockItems > 0 ? colors.warning : colors.success },
    { label: 'Locations', value: summary.totalLocations, color: colors.brandSecondary },
    { label: 'Pending inquiries', value: summary.pendingInquiries, color: summary.pendingInquiries > 0 ? '#f9a825' : colors.success },
    { label: 'Total sales (P)', value: `P${summary.totalSales.toLocaleString()}`, color: colors.success },
    { label: 'Stock movements', value: summary.totalMovements, color: colors.info },
    { label: 'Active alerts', value: summary.activeAlerts, color: summary.activeAlerts > 0 ? colors.error : colors.success },
  ];

  if (error && loading === false) {
    return (
      <AdminLayout title="Admin Dashboard" onLogout={onLogout}>
        <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: colors.surfaceAlt }}>
          <Typography variant="h6" color="error" gutterBottom>Unable to load dashboard</Typography>
          <Typography color="text.secondary">{error}</Typography>
          <Typography variant="body2" sx={{ mt: 2 }}>Run the backend server first.</Typography>
        </Paper>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Admin Dashboard" onLogout={onLogout}>
      <Box sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <Typography variant="subtitle1" color="text.secondary">
          Welcome back, <strong>{user?.username}</strong>. Review the latest inventory health and analytics.
        </Typography>
        {summary.activeAlerts > 0 && (
          <Chip label={`${summary.activeAlerts} active alert(s)`} color="error" size="small" />
        )}
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3}>
        {panels.map((panel) => (
          <Grid item xs={12} sm={6} md={3} key={panel.label}>
            <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3, borderLeft: `4px solid ${panel.color}` }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, fontSize: '0.75rem' }}>
                {panel.label}
              </Typography>
              <Typography variant="h5" color="text.primary" sx={{ fontWeight: 700 }}>
                {loading ? '...' : panel.value}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Top Products by Stock Value</Typography>
            {productValueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={productValueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val) => `P${val.toLocaleString()}`} />
                  <Bar dataKey="value" fill={colors.brandPrimary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Typography color="text.secondary">No product data available</Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Stock Movement Distribution</Typography>
            {movementChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Stock In', value: movementChartData.reduce((s, m) => s + m['stock-in'], 0) },
                      { name: 'Stock Out', value: movementChartData.reduce((s, m) => s + m['stock-out'], 0) },
                      { name: 'Transfer', value: movementChartData.reduce((s, m) => s + m.transfer, 0) },
                      { name: 'Adjustment', value: movementChartData.reduce((s, m) => s + m.adjustment, 0) },
                    ].filter(d => d.value > 0)}
                    cx="50%" cy="50%" outerRadius={100}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {CHART_COLORS.map((color, i) => <Cell key={i} fill={color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Typography color="text.secondary">No movement data yet</Typography>
            )}
          </Paper>
        </Grid>

      {/* Monthly Trends */}
      <Box sx={{ mt: 3 }}>
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
          <Typography variant="h6" mb={2}>Monthly Movement Trends</Typography>
          {movementChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={movementChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="stock-in" name="Stock In" fill={colors.brandPrimary} radius={[4, 4, 0, 0]} />
                <Bar dataKey="stock-out" name="Stock Out" fill={colors.error} radius={[4, 4, 0, 0]} />
                <Bar dataKey="transfer" name="Transfer" fill={colors.info} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Typography color="text.secondary">No monthly data available</Typography>
          )}
        </Paper>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

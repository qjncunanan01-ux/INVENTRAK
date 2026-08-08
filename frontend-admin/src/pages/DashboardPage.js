import { Box, Chip, Grid, Paper, Skeleton, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet, getInventory, getOptimizationAbc, imageUrl, listProducts } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';
import { buildFlashPicks, dealPricing, formatCountdown, msUntilDailyRefresh, stockMapFromInventory } from '../flash-sale';

const CHART_COLORS = ['#1f640e', '#a8d22b', '#e9ffd5', '#4caf50', '#81c784', '#c8e6c9'];

export default function DashboardPage({ user, onLogout }) {
  const [summary, setSummary] = useState({
    totalProducts: 0, totalStock: 0, lowStockItems: 0, totalLocations: 0,
    pendingInquiries: 0, totalSales: 0, totalMovements: 0, activeAlerts: 0,
    topProducts: [], monthlyMovements: [],
    // Reviewer-required dashboard data
    lowStockList: [], stockByLocation: [], fastMovingProducts: [],
    slowMovingProducts: [], dailySalesValue: [], transactionCount: 0,
    customersServed: 0, orderStatusSummary: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  // Today's flash-sale picks (same algorithm + API payloads as the mobile
  // app's carousels, so the dashboard shows exactly what customers see).
  const [flashDeals, setFlashDeals] = useState([]);
  const [now, setNow] = useState(Date.now());

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

  // Parallel fetch of the exact three payloads the mobile Home/Recommendations
  // screens use, then compute today's picks with the SHARED algorithm (see
  // flash-sale.js — an exact port of mobile-client/src/flash-sale.js). The ABC
  // failure is tolerated the same way the mobile app tolerates it: the picks
  // still fill from the general photo pool.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Every fetch is guarded (listProducts included): if ANY of the three
        // fails, the card degrades gracefully instead of blanking — an empty
        // product list falls through to buildFlashPicks' photo-pool top-up,
        // exactly like the mobile app tolerates a failed ABC call.
        const [abcData, products, inv] = await Promise.all([
          getOptimizationAbc().catch(() => []),
          listProducts().catch(() => []),
          getInventory().catch(() => null),
        ]);
        if (cancelled) return;
        const abc = abcData && abcData.data ? abcData.data : (Array.isArray(abcData) ? abcData : []);
        setFlashDeals(buildFlashPicks(abc, products, stockMapFromInventory(inv)));
      } catch {
        // The card simply stays empty — the summary still renders.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Ticking countdown to the daily pick rotation (midnight), Shopee-style.
  // Only runs while there is something to count down to — no pointless timer
  // in the empty/failed state.
  useEffect(() => {
    if (flashDeals.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [flashDeals.length]);

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

  // Reviewer: available stocks per location.
  const locationChartData = (summary.stockByLocation || []).map(l => ({
    name: l.location,
    stock: l.total,
  }));

  // Reviewer: daily sales value (last 7 days).
  const dailySalesData = (summary.dailySalesValue || []).map(d => ({
    date: (d.date || '').slice(5),
    value: Math.round(d.value),
  }));

  // Reviewer: order status summary.
  const os = summary.orderStatusSummary || {};
  const statusChartData = [
    { name: 'Pending', value: os.pending || 0 },
    { name: 'Approved', value: os.approved || 0 },
    { name: 'Fulfilled', value: os.fulfilled || 0 },
    { name: 'Delivered', value: os.delivered || 0 },
    { name: 'Rejected', value: os.rejected || 0 },
  ].filter(d => d.value > 0);

  const panels = [
    { label: 'Total products', value: summary.totalProducts, color: colors.brandPrimary },
    { label: 'Total inventory', value: summary.totalStock.toLocaleString(), color: colors.info },
    { label: 'Low stock items', value: summary.lowStockItems, color: summary.lowStockItems > 0 ? colors.warning : colors.success },
    { label: 'Locations', value: summary.totalLocations, color: colors.brandSecondary },
    { label: 'Pending inquiries', value: summary.pendingInquiries, color: summary.pendingInquiries > 0 ? '#f9a825' : colors.success },
    { label: 'Total sales (P)', value: `P${summary.totalSales.toLocaleString()}`, color: colors.success },
    { label: 'Stock movements', value: summary.totalMovements, color: colors.info },
    { label: 'Active alerts', value: summary.activeAlerts, color: summary.activeAlerts > 0 ? colors.error : colors.success },
    { label: 'Transactions', value: summary.transactionCount, color: colors.brandPrimary },
    { label: 'Customers served', value: summary.customersServed, color: '#7b1fa2' },
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
          Welcome back, <strong>{user?.username}</strong>. Review the latest inventory health, sales analytics, and order statuses.
        </Typography>
        {summary.activeAlerts > 0 && (
          <Chip label={`${summary.activeAlerts} active alert(s)`} color="error" size="small" />
        )}
      </Box>

      {/* Today's Flash Deals — what the customer app is offering right now.
          Computed with the exact algorithm + API payloads the mobile
          carousels use, so this mirrors the customer-facing deals precisely.
          Deal prices are the same deterministic day-seeded discounts; the
          countdown ticks to midnight when the picks rotate. */}
      <Paper
        sx={{
          mt: 3,
          p: 3,
          borderRadius: 3,
          backgroundColor: colors.surfaceAlt,
          border: '1px solid rgba(226,55,68,0.15)',
        }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>⚡ Today's Flash Deals</span>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Daily top-value picks your customers see on the app — new deals every midnight
            </Typography>
          </Box>
          <Box
            sx={{
              ml: 'auto',
              backgroundColor: '#e23744',
              color: '#fff',
              borderRadius: 2,
              px: 2,
              py: 1,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {loading ? 'ENDS IN --:--:--' : `ENDS IN ${formatCountdown(msUntilDailyRefresh(now))}`}
          </Box>
        </Box>

        {loading ? (
          <Skeleton variant="rounded" height={200} />
        ) : flashDeals.length === 0 ? (
          <Typography color="text.secondary" py={4} textAlign="center">
            No flash deals available right now — the picks need photo + in-stock products.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 1 }}>
            {flashDeals.map((pick) => {
              const deal = dealPricing(pick);
              return (
                <Box
                  key={pick.id}
                  sx={{
                    minWidth: 180,
                    maxWidth: 180,
                    backgroundColor: colors.surface,
                    borderRadius: 2,
                    p: 1.5,
                    border: '1px solid rgba(0,0,0,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Box
                    component="img"
                    src={imageUrl(pick.image)}
                    alt={pick.name}
                    sx={{
                      width: '100%',
                      height: 96,
                      objectFit: 'cover',
                      borderRadius: 1.5,
                      backgroundColor: colors.surfaceAlt,
                    }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 1, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: '0.65rem' }}
                  >
                    {pick.category}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.25, minHeight: 36 }}>
                    {pick.name}
                  </Typography>
                  {deal ? (
                    <Box sx={{ mt: 'auto', pt: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                        <Typography sx={{ color: '#e23744', fontWeight: 800, fontSize: '1.05rem' }}>
                          P{deal.deal}
                        </Typography>
                        <Typography
                          sx={{ color: '#9aa0a6', textDecoration: 'line-through', fontSize: '0.72rem' }}
                        >
                          P{deal.original}
                        </Typography>
                      </Box>
                      <Chip
                        label={`-${deal.pct}%`}
                        size="small"
                        sx={{
                          mt: 0.75,
                          backgroundColor: '#ffe3dd',
                          color: '#e23744',
                          fontWeight: 800,
                          fontSize: '0.7rem',
                          height: 20,
                        }}
                      />
                    </Box>
                  ) : (
                    <Typography sx={{ mt: 'auto', pt: 1, color: colors.brandPrimary, fontWeight: 800 }}>
                      P{pick.price}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>

      {/* Summary Cards */}
      <Grid container spacing={3}>
        {panels.map((panel) => (
          <Grid item xs={12} sm={6} md={2} lg={2} key={panel.label}>
            <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3, borderLeft: `4px solid ${panel.color}` }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, fontSize: '0.75rem' }}>
                {panel.label}
              </Typography>
              <Typography variant="h5" color="text.primary" sx={{ fontWeight: 700 }}>
                {loading ? <Skeleton variant="text" width="62%" /> : panel.value}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Charts Row 1: sales value + order status */}
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Daily Sales Value (last 7 days)</Typography>
            {loading ? <Skeleton variant="rounded" height={260} /> : dailySalesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dailySalesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val) => `P${val.toLocaleString()}`} />
                  <Line type="monotone" dataKey="value" stroke={colors.success} strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Typography color="text.secondary">No sales in the last 7 days</Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Order Status Summary</Typography>
            {loading ? <Skeleton variant="rounded" height={260} /> : statusChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%" cy="50%" outerRadius={95}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {['#f9a825', colors.info, colors.success, colors.brandPrimary, colors.error].map((color, i) => (
                      <Cell key={i} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Typography color="text.secondary">No inquiries yet</Typography>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Charts Row 2: stock per location + movement distribution */}
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Available Stocks per Location</Typography>
            {loading ? <Skeleton variant="rounded" height={260} /> : locationChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={locationChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="stock" name="Units" fill={colors.brandPrimary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Typography color="text.secondary">No location data available</Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Stock Movement Distribution</Typography>
            {loading ? <Skeleton variant="rounded" height={260} /> : movementChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
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
      </Grid>

      {/* Fast vs slow movers */}
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Fast-Moving Products</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Units sold</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={2}><Skeleton height={24} /></TableCell></TableRow>
                ) : (summary.fastMovingProducts || []).length === 0 ? (
                  <TableRow><TableCell colSpan={2}><Typography color="text.secondary">No sales data</Typography></TableCell></TableRow>
                ) : summary.fastMovingProducts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell align="right"><strong>{p.qty_sold}</strong></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Slow-Moving Products</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Units sold</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={2}><Skeleton height={24} /></TableCell></TableRow>
                ) : (summary.slowMovingProducts || []).length === 0 ? (
                  <TableRow><TableCell colSpan={2}><Typography color="text.secondary">No product data</Typography></TableCell></TableRow>
                ) : summary.slowMovingProducts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell align="right">{p.qty_sold}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>

      {/* Low stock list + top products value */}
      <Grid container spacing={3} sx={{ mt: 1 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Low-Stock Items (below 80 units)</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Total stock</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={2}><Skeleton height={24} /></TableCell></TableRow>
                ) : (summary.lowStockList || []).length === 0 ? (
                  <TableRow><TableCell colSpan={2}><Typography color="text.secondary">No low-stock items 🎉</Typography></TableCell></TableRow>
                ) : summary.lowStockList.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell align="right"><Chip label={p.total} size="small" color="warning" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2}>Top Products by Stock Value</Typography>
            {loading ? <Skeleton variant="rounded" height={260} /> : productValueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
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

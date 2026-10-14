import { Box, Chip, Grid, IconButton, Paper, Snackbar, Tooltip, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import HistoryIcon from '@mui/icons-material/History';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PeopleIcon from '@mui/icons-material/People';
import ReceiptIcon from '@mui/icons-material/Receipt';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FormulaBanner from '../../components/FormulaBanner';
import RangeFilter from '../../components/RangeFilter';
import { DEFAULT_RANGE, isWithinRange, resolveRange } from '../../dateRange';
import { isManagement } from '../../roles';
import { apiGet, getCurrentUser } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';
import StatCard from './StatCard';
import DashboardDetailModal from './DashboardDetailModal';
import { SectionLabel } from './DashboardSection';
import { InventoryAnalyticsSection, VelocitySection, SalesOrdersSection, MovementSection } from './DashboardCharts';
import { buildModalData, filterModalData } from './dashboard-helpers';
import { deriveDashboard } from './dashboard-data';

// Container for the Dashboard module: it owns all state, the single load effect
// and the derived chart/modal data, and composes the presentational pieces
// (StatCard, the four chart sections, the detail modal) that were split out of
// this file.
export default function DashboardPage({ user, onLogout }) {
  usePageTitle('/');
  const navigate = useNavigate();

  // Days / Weeks / Months / Quarterly / Annually filter. Top control updates
  // all sections, and each individual section can also be filtered independently.
  const [rangePreset, setRangePreset] = useState(DEFAULT_RANGE);
  const [inventoryRange, setInventoryRange] = useState(DEFAULT_RANGE);
  const [velocityRange, setVelocityRange] = useState(DEFAULT_RANGE);
  const [salesOrdersRange, setSalesOrdersRange] = useState(DEFAULT_RANGE);
  const [movementRange, setMovementRange] = useState(DEFAULT_RANGE);

  const range = useMemo(() => resolveRange(rangePreset), [rangePreset]);

  const handleGlobalRangeChange = (nextPreset) => {
    setRangePreset(nextPreset);
    setInventoryRange(nextPreset);
    setVelocityRange(nextPreset);
    setSalesOrdersRange(nextPreset);
    setMovementRange(nextPreset);
  };

  const userRole = getCurrentUser()?.role || user?.role || 'admin';
  const isExecutive = isManagement(userRole); // owner & super_admin ONLY (full financial oversight)
  const isStaffRole = userRole === 'staff';
  const moneyVisible = isExecutive;
  const [summary, setSummary] = useState({
    totalProducts: 0, totalStock: 0, lowStockItems: 0, totalLocations: 0,
    pendingInquiries: 0, totalSales: 0, totalMovements: 0, activeAlerts: 0,
    // New metrics
    monthlySalesValue: 0, monthlyTransactions: 0, customersServed: 0,
    orderStatusCounts: { pending: 0, approved: 0, rejected: 0 },
    // Chart data
    topProducts: [], monthlyMovements: [],
    fastMoving: [], slowMoving: [],
    locationStock: [], monthlySalesChart: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const [activeModal, setActiveModal] = useState(null);
  const [modalData, setModalData] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [rawData, setRawData] = useState({
    inventory: [], sales: [], inquiries: [], movements: [], products: [],
    alerts: [], summary: null, dailySales: [], accounts: [],
  });

  useEffect(() => {
    const load = async() => {
      try {
        setLoading(true);
        const [summaryRes, inventoryRes, productsRes, locationsRes, inquiriesRes, salesRes, movementsRes, alertsRes, accountsRes] = await Promise.allSettled([
          apiGet('/api/analytics/summary'),
          apiGet('/api/inventory'),
          apiGet('/api/products'),
          apiGet('/api/locations'),
          apiGet('/api/order-inquiries'),
          apiGet('/api/sales'),
          apiGet('/api/stock-movements'),
          apiGet('/api/alerts'),
          apiGet('/api/users'),
        ]);

        const summaryData = summaryRes.status === 'fulfilled' ? (summaryRes.value.data || summaryRes.value) : {};
        const inventoryData = inventoryRes.status === 'fulfilled' ? (inventoryRes.value.data || inventoryRes.value) : { items: [], locations: [] };
        const productsData = productsRes.status === 'fulfilled' ? (productsRes.value.data || productsRes.value) : [];
        const locationsData = locationsRes.status === 'fulfilled' ? (locationsRes.value.data || locationsRes.value) : [];
        const inquiriesData = inquiriesRes.status === 'fulfilled' ? (inquiriesRes.value.data || inquiriesRes.value) : [];
        const salesData = salesRes.status === 'fulfilled' ? (salesRes.value.data || salesRes.value) : [];
        const movementsData = movementsRes.status === 'fulfilled' ? (movementsRes.value.data || movementsRes.value) : [];
        const alertsData = alertsRes.status === 'fulfilled' ? (alertsRes.value.data || alertsRes.value) : [];
        // Customer accounts (the Total Registered Customers KPI's source of
        // truth). Staff get 403 here — allSettled turns that into [].
        const accountsData = accountsRes.status === 'fulfilled' ? (accountsRes.value.data || accountsRes.value) : [];

        // Staff cannot read the raw sales ledger (GET /api/sales is 403 by
        // role design), so pull the daily sales aggregate from /api/reports
        // (staff-allowed) to keep this-month totals and the chart populated
        // instead of showing zeros.
        const isStaff = getCurrentUser()?.role === 'staff';
        let reportsData = null;
        if (isStaff) {
          try {
            const r = await apiGet('/api/reports?days=90');
            reportsData = r.data || r;
          } catch (e) {
            reportsData = null;
          }
        }
        const dailySales = isStaff && reportsData && Array.isArray(reportsData.dailySales)
          ? reportsData.dailySales
          : [];

        const items = inventoryData.items || [];

        // One pure function turns the raw payloads into the rows the modals
        // read and the numbers the cards/charts render (see dashboard-data.js).
        const { rawData: nextRaw, summary: nextSummary } = deriveDashboard({
          summaryData,
          items,
          productsData,
          locationsData,
          inquiriesData,
          salesData,
          movementsData,
          alertsData,
          accountsData,
          isStaff,
          dailySales,
          range,
        });
        setRawData(nextRaw);
        setSummary(nextSummary);

      } catch (err) {
        setError('Failed to load dashboard data. Make sure the backend is running.');
        setSnackbar({ open: true, message: err.message });
      } finally {
        setLastRefreshed(new Date());
        setLoading(false);
      }
    };
    load();
    // Re-derive the analytics whenever the range preset changes.
  }, [rangePreset]);

  // Click a stat card → open its detail modal with rows derived from rawData.
  const handleCardClick = (panel) => {
    setActiveModal(panel);
    setModalLoading(false);
    setSearchQuery('');
    setModalData(buildModalData(panel, rawData));
  };

  // Section 1 — Inventory Analytics (dynamically filtered by inventoryRange)
  const invRange = useMemo(() => resolveRange(inventoryRange), [inventoryRange]);
  const productValueData = useMemo(() => {
    const products = rawData.products || [];
    let list = products
      .map(item => ({
        name: item.name || '',
        value: Math.round((Number(item.price) || 0) * (Number(item.stock || item.quantity || item.total) || 0)),
      }))
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    if (list.length === 0 && summary.topProducts) {
      list = summary.topProducts.map(p => ({
        name: p.name?.length > 15 ? p.name.substring(0, 15) + '…' : p.name,
        value: Math.round(p.stock_value),
      }));
    }
    return list;
  }, [rawData.products, summary.topProducts, invRange]);

  const locationStockData = useMemo(() => {
    const inventory = rawData.inventory || [];
    const locationStockMap = {};
    inventory.forEach(item => {
      Object.entries(item.locations || {}).forEach(([loc, qty]) => {
        locationStockMap[loc] = (locationStockMap[loc] || 0) + Number(qty);
      });
    });
    let list = Object.entries(locationStockMap)
      .map(([location, stock]) => ({ location, stock }))
      .sort((a, b) => b.stock - a.stock);

    if (list.length === 0 && summary.locationStock) {
      list = summary.locationStock;
    }
    return list;
  }, [rawData.inventory, summary.locationStock, invRange]);

  // Section 2 — Product Sales Velocity (dynamically filtered by velocityRange)
  const velRange = useMemo(() => resolveRange(velocityRange), [velocityRange]);
  const { fastMovingData, slowMovingData } = useMemo(() => {
    const isStaff = getCurrentUser()?.role === 'staff';
    const sales = (rawData.sales || []).filter(s =>
      isWithinRange(s.transaction_date || s.created_at || s.date, velRange),
    );

    if (isStaff && sales.length === 0) {
      const fmt = (list) => (list || []).map(p => ({
        name: (p.name || 'Product').length > 20 ? (p.name || 'Product').substring(0, 20) + '…' : (p.name || 'Product'),
        qty: Number(p.qty_sold) || 0,
      }));
      return {
        fastMovingData: fmt(summary.fastMovingProducts || summary.fastMoving).slice(0, 5),
        slowMovingData: fmt(summary.slowMovingProducts || summary.slowMoving).slice(-5).reverse(),
      };
    }

    const productSalesMap = {};
    sales.forEach(s => {
      const key = s.product_name || `Product #${s.product_id}`;
      productSalesMap[key] = (productSalesMap[key] || 0) + (Number(s.qty || s.quantity) || 0);
    });

    const sortedBySales = Object.entries(productSalesMap).sort((a, b) => b[1] - a[1]);
    const fastMoving = sortedBySales.slice(0, 5).map(([name, qty]) => ({
      name: name.length > 20 ? name.substring(0, 20) + '…' : name,
      qty,
    }));
    const slowMoving = sortedBySales.slice(-5).reverse().map(([name, qty]) => ({
      name: name.length > 20 ? name.substring(0, 20) + '…' : name,
      qty,
    }));

    if (fastMoving.length === 0 && summary.fastMoving?.length > 0) {
      return { fastMovingData: summary.fastMoving, slowMovingData: summary.slowMoving };
    }

    return { fastMovingData: fastMoving, slowMovingData: slowMoving };
  }, [rawData.sales, summary, velRange]);

  // Section 3 — Sales & Orders Analytics (dynamically filtered by salesOrdersRange)
  const soRange = useMemo(() => resolveRange(salesOrdersRange), [salesOrdersRange]);
  const { monthlySalesChartData, orderStatusPieData } = useMemo(() => {
    const isStaff = getCurrentUser()?.role === 'staff';
    const sales = (rawData.sales || []).filter(s =>
      isWithinRange(s.transaction_date || s.created_at || s.date, soRange),
    );
    const inquiries = (rawData.inquiries || []).filter(i =>
      isWithinRange(i.created_at || i.date, soRange),
    );
    const dailySales = rawData.dailySales || [];

    let chartData = [];
    if (isStaff && dailySales.length > 0) {
      const monthlySalesMapChart = {};
      dailySales.forEach(d => {
        if (isWithinRange(d.date, soRange)) {
          const month = (d.date || '').substring(0, 7);
          if (month) monthlySalesMapChart[month] = (monthlySalesMapChart[month] || 0) + (Number(d.value) || 0);
        }
      });
      chartData = Object.entries(monthlySalesMapChart)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([month, value]) => ({ month, value: Math.round(value) }));
    } else {
      const monthlySalesMapChart = {};
      sales.forEach(s => {
        const month = (s.transaction_date || s.created_at || '').substring(0, 7);
        if (month) monthlySalesMapChart[month] = (monthlySalesMapChart[month] || 0) + (Number(s.total_amount || s.total_price) || 0);
      });
      chartData = Object.entries(monthlySalesMapChart)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([month, value]) => ({ month, value: Math.round(value) }));
    }

    if (chartData.length === 0 && summary.monthlySalesChart?.length > 0) {
      chartData = summary.monthlySalesChart;
    }

    const pending = inquiries.filter(i => i.status === 'pending').length;
    const approved = inquiries.filter(i => i.status === 'approved' || i.status === 'fulfilled').length;
    const rejected = inquiries.filter(i => i.status === 'rejected' || i.status === 'cancelled').length;

    let pieData = [
      { name: 'Pending', value: pending },
      { name: 'Approved', value: approved },
      { name: 'Rejected', value: rejected },
    ].filter(d => d.value > 0);

    if (pieData.length === 0 && summary.orderStatusCounts) {
      pieData = [
        { name: 'Pending', value: summary.orderStatusCounts.pending || 0 },
        { name: 'Approved', value: summary.orderStatusCounts.approved || 0 },
        { name: 'Rejected', value: summary.orderStatusCounts.rejected || 0 },
      ].filter(d => d.value > 0);
    }

    return { monthlySalesChartData: chartData, orderStatusPieData: pieData };
  }, [rawData, summary, soRange]);

  // Section 4 — Stock Movement Analytics (dynamically filtered by movementRange)
  const movRange = useMemo(() => resolveRange(movementRange), [movementRange]);
  const { movementChartData } = useMemo(() => {
    const movements = (rawData.movements || []).filter(m =>
      isWithinRange(m.created_at || m.transaction_date || m.date, movRange),
    );

    const monthTypeMap = {};
    movements.forEach(m => {
      const month = (m.created_at || m.transaction_date || '').substring(0, 7);
      if (!month) return;
      const key = `${month}|${m.type}`;
      if (!monthTypeMap[key]) monthTypeMap[key] = { month, type: m.type, count: 0 };
      monthTypeMap[key].count += 1;
    });

    let monthlyMovements = Object.values(monthTypeMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);

    if (monthlyMovements.length === 0 && summary.monthlyMovements?.length > 0) {
      monthlyMovements = summary.monthlyMovements;
    }

    const movementTypes = {};
    monthlyMovements.forEach(m => {
      if (!movementTypes[m.month]) movementTypes[m.month] = {};
      movementTypes[m.month][m.type] = m.count;
    });

    const chartData = Object.entries(movementTypes).slice(0, 6).map(([month, types]) => ({
      month,
      'stock-in': types['stock-in'] || 0,
      'stock-out': types['stock-out'] || 0,
      transfer: types.transfer || 0,
      adjustment: types.adjustment || 0,
    }));

    return { movementChartData: chartData };
  }, [rawData.movements, summary, movRange]);

  const panels = [
    // Row 1 — Inventory
    { key: 'products', label: 'Total Products', value: summary.totalProducts, numericValue: summary.totalProducts, color: colors.brandPrimary, icon: <Inventory2Icon color="primary" />, navigateTo: '/products' },
    { key: 'inventory', label: 'Total Inventory', value: summary.totalStock, numericValue: summary.totalStock, color: colors.info, icon: <Inventory2Icon color="info" />, navigateTo: '/inventory' },
    { key: 'lowStock', label: 'Low Stock Items', value: summary.lowStockItems, numericValue: summary.lowStockItems, color: summary.lowStockItems > 0 ? colors.warning : colors.success, icon: <WarningAmberIcon color="warning" />, navigateTo: '/inventory' },
    { key: 'locationStock', label: 'Locations', value: summary.totalLocations, numericValue: summary.totalLocations, color: colors.brandSecondary, icon: <LocationOnIcon color="secondary" />, navigateTo: '/locations' },
    // Row 2 — Sales & Operations (`money: true` marks a peso figure that is
    // hidden for roles without revenue visibility).
    { key: 'monthlySales', label: 'Sales This Month', value: summary.monthlySalesValue, numericValue: summary.monthlySalesValue, prefix: 'P', money: true, color: colors.success, icon: <AttachMoneyIcon color="success" />, navigateTo: '/stock-movement' },
    { key: 'sales', label: 'Total Sales (selected range)', value: summary.totalSales, numericValue: summary.totalSales, prefix: 'P', money: true, color: colors.brandPrimary, icon: <AttachMoneyIcon color="primary" />, navigateTo: '/stock-movement' },
    { key: 'customers', label: 'Customers Served', value: summary.customersServed, numericValue: summary.customersServed, color: colors.info, icon: <PeopleIcon color="info" />, navigateTo: '/order-inquiries' },
    { key: 'customersRegistered', label: 'Total Registered Customers', value: summary.customersRegistered, numericValue: summary.customersRegistered, color: colors.brandSecondary, icon: <PeopleIcon color="secondary" />, navigateTo: '/users' },
    { key: 'orderStatus', label: 'Order Status', value: summary.orderStatusCounts.pending, numericValue: summary.orderStatusCounts.pending, suffix: ' Pending', color: summary.orderStatusCounts.pending > 0 ? colors.warning : colors.success, icon: <ReceiptIcon color="warning" />, navigateTo: '/order-inquiries' },
    // Row 3 — Activity
    { key: 'monthlySalesTx', label: 'Transactions This Month', value: summary.monthlyTransactions, numericValue: summary.monthlyTransactions, color: colors.brandSecondary, icon: <ReceiptIcon />, navigateTo: '/stock-movement' },
    { key: 'inquiries', label: 'Pending Inquiries', value: summary.pendingInquiries, numericValue: summary.pendingInquiries, color: summary.pendingInquiries > 0 ? '#f9a825' : colors.success, icon: <ShoppingCartIcon color="warning" />, navigateTo: '/order-inquiries' },
    { key: 'movements', label: 'Stock Movements', value: summary.totalMovements, numericValue: summary.totalMovements, color: colors.info, icon: <HistoryIcon color="info" />, navigateTo: '/stock-movement' },
    { key: 'alerts', label: 'Active Alerts', value: summary.activeAlerts, numericValue: summary.activeAlerts, color: summary.activeAlerts > 0 ? colors.error : colors.success, icon: <NotificationsActiveIcon color="error" />, navigateTo: '/optimization' },
  ];

  const filteredModalData = filterModalData(modalData, searchQuery);

  if (error && loading === false) {
    return (
      <AdminLayout title="Admin Dashboard" onLogout={onLogout}>
        <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: colors.surfaceAlt }} aria-live="polite">
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
        {summary.lowStockItems > 0 && (
          <Chip label={`${summary.lowStockItems} low-stock location(s)`} color="warning" size="small" />
        )}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {/* Shared Days/Weeks/Months/Quarterly/Annually filter. Updates global
              state and syncs sub-filters. */}
          <RangeFilter value={rangePreset} onChange={handleGlobalRangeChange} compact />
          {lastRefreshed && (
            <Typography variant="caption" color="text.secondary" aria-live="polite">
              Updated {lastRefreshed.toLocaleTimeString()}
            </Typography>
          )}
          <Tooltip title="Refresh data">
            <IconButton size="small" onClick={() => window.location.reload()}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ─── Summary Cards ─── */}
      <SectionLabel>Inventory Overview</SectionLabel>
      <Grid container spacing={2}>
        {panels.slice(0, 4).map((panel, index) => (
          <Grid item xs={12} sm={6} md={3} key={panel.label}>
            <StatCard panel={panel} loading={loading} onClick={handleCardClick} index={index} />
          </Grid>
        ))}
      </Grid>

      <SectionLabel>Sales & Orders</SectionLabel>
      {/* The math every peso figure on this row is derived from — mirrors the
          analytics/summary aggregation in the backend. */}
      <FormulaBanner
        dense
        title="Sales & Orders card math"
        items={[
          'Total Sales   = Σ total_amount of every sale inside the selected date range',
          'This Month    = Σ total_amount where sale month = current month   ·   Transactions = sale count',
          'Pending       = inquiries with status "pending"   ·   Alerts = active low-stock / expiry entries',
        ]}
        note="Peso values are executive-only (Owner / Super Admin) — other roles see the count, never the amount."
      />
      <Grid container spacing={2} sx={{ mt: 0.25 }}>
        {panels.slice(4, 8).map((panel, index) => {
          // Customers Served is account-based (executive oversight per the
          // role split); Total Registered Customers is the account base, so
          // both stay executive-only. Money cards stay executive-only too.
          const isMasked =
            panel.key === 'customers' || panel.key === 'customersRegistered'
              ? !isExecutive
              : Boolean(panel.money) && !isExecutive;
          return (
            <Grid item xs={12} sm={6} md={3} key={panel.label}>
              <StatCard
                panel={panel}
                loading={loading}
                onClick={handleCardClick}
                index={index + 4}
                masked={isMasked}
                maskLabel={isMasked ? 'Executive Only' : ''}
              />
            </Grid>
          );
        })}
      </Grid>

      <SectionLabel>Activity</SectionLabel>
      <Grid container spacing={2}>
        {/* 13 panels total: 4 + 4 above, the last 5 here (orderStatus moved
            down with the new registered-customers card) — the fifth card
            simply wraps to a second row. */}
        {panels.slice(8, 13).map((panel, index) => {
          const isMasked = panel.key === 'monthlySalesTx' ? !isExecutive : (panel.key === 'inquiries' ? isStaffRole : false);
          return (
            <Grid item xs={12} sm={6} md={3} key={panel.label}>
              <StatCard
                panel={panel}
                loading={loading}
                onClick={handleCardClick}
                index={index + 8}
                masked={isMasked}
                maskLabel={isMasked ? (panel.key === 'inquiries' ? 'Admin / Exec Only' : 'Executive Only') : ''}
              />
            </Grid>
          );
        })}
      </Grid>

      {/* ─── Charts ─── */}
      <InventoryAnalyticsSection
        isExecutive={isExecutive}
        productValueData={productValueData}
        locationStockData={locationStockData}
      />

      <VelocitySection
        rangeValue={velocityRange}
        onRangeChange={setVelocityRange}
        fastMovingData={fastMovingData}
        slowMovingData={slowMovingData}
      />

      <SalesOrdersSection
        rangeValue={salesOrdersRange}
        onRangeChange={setSalesOrdersRange}
        isExecutive={isExecutive}
        isStaffRole={isStaffRole}
        monthlySalesChartData={monthlySalesChartData}
        orderStatusPieData={orderStatusPieData}
      />

      <MovementSection
        rangeValue={movementRange}
        onRangeChange={setMovementRange}
        movementChartData={movementChartData}
      />

      {/* ─── Detailed Items Modal ─── */}
      <DashboardDetailModal
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        filteredModalData={filteredModalData}
        searchQuery={searchQuery}
        onSearchQuery={setSearchQuery}
        modalLoading={modalLoading}
        moneyVisible={moneyVisible}
        onNavigate={(target) => { setActiveModal(null); navigate(target); }}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        role="status"
        aria-live="polite"
      />
    </AdminLayout>
  );
}

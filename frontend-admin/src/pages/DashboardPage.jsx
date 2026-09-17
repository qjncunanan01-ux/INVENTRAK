import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Grid, IconButton, InputAdornment,
  Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import HistoryIcon from '@mui/icons-material/History';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import PeopleIcon from '@mui/icons-material/People';
import ReceiptIcon from '@mui/icons-material/Receipt';
import FactCheckIcon from '@mui/icons-material/FactCheck'; //Added as of August 27, 2026.
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState, useCallback } from 'react';
import AnimatedCounter from '../components/AnimatedCounter';
import FormulaBanner from '../components/FormulaBanner';
import LiquidGlassCard from '../components/LiquidGlassCard';
import RangeFilter from '../components/RangeFilter';
import { MONEY_MASK } from '../components/Money';
import { DEFAULT_RANGE, isWithinRange, resolveRange } from '../dateRange';
import { canSeeMoney, isManagement } from '../roles';
import { useNavigate } from 'react-router-dom';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart,
  Pie, PieChart,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis
} from 'recharts';
import { apiGet, getCurrentUser } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';

const CHART_COLORS = ['#1f640e', '#a8d22b', '#f9a825', '#1565c0', '#d32f2f', '#c8e6c9'];
const FAST_COLOR = '#1f640e';
const SLOW_COLOR = '#f9a825';

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
    const load = async () => {
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
          apiGet('/api/users')
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

        // Alert list fetch is admin-only (staff get 403, handled by
        // allSettled) — the staff dashboard falls back to the low-stock
        // entries it can read from inventory instead.
        const rawAlerts = Array.isArray(alertsData) ? alertsData : [];

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

        // Apply the selected date range to the ledger rows. Everything derived
        // from sales/movements below (totals, this-month KPIs, velocity charts,
        // monthly charts) inherits the filter automatically.
        const inRange = (rows) =>
          (Array.isArray(rows) ? rows : []).filter((r) =>
            isWithinRange(r.transaction_date || r.created_at || r.date, range)
          );
        const rangeSales = inRange(salesData);
        const rangeMovements = inRange(movementsData);

        setRawData({
          inventory: items,
          sales: rangeSales,
          inquiries: Array.isArray(inquiriesData) ? inquiriesData : [],
          movements: rangeMovements,
          products: Array.isArray(productsData) ? productsData : [],
          alerts: rawAlerts,
          accounts: Array.isArray(accountsData) ? accountsData : [],
          // Staff-visible fallbacks the detail modals reuse so a card's value
          // and its modal never disagree (same source the cards count from).
          summary: summaryData,
          dailySales,
        });

        // 1. Total products count
        const totalProducts = Array.isArray(productsData) && productsData.length > 0
          ? productsData.length
          : (summaryData.totalProducts || items.length);

        // 2. Total inventory stock
        const totalStock = items.length > 0
          ? items.reduce((sum, item) => sum + (Number(item.total) || 0), 0)
          : (summaryData.totalStock || 0);

        // 3. Low stock location entries (< 80)
        let lowStockCount = 0;
        items.forEach(item => {
          if (item.locations) {
            Object.values(item.locations).forEach(qty => {
              if (Number(qty) < 80) lowStockCount++;
            });
          }
        });
        if (lowStockCount === 0 && summaryData.lowStockItems) {
          lowStockCount = summaryData.lowStockItems;
        }

        // 4. Locations count
        const totalLocations = Array.isArray(locationsData) && locationsData.length > 0
          ? locationsData.length
          : (inventoryData.locations?.length || summaryData.totalLocations || 0);

        // 5. Pending inquiries count. Staff GET /api/order-inquiries is
        // scoped to their own account (always empty), so their dashboard must
        // fall back to the public summary count — otherwise the card would
        // show 0 while orders are actually pending.
        const pendingInquiries = isStaff
          ? (summaryData.pendingInquiries || 0)
          : (Array.isArray(inquiriesData)
              ? inquiriesData.filter(i => i.status === 'pending').length
              : (summaryData.pendingInquiries || 0));

        // 6. Total sales amount (inside the selected range)
        const sales = rangeSales;
        const totalSales = sales.length > 0
          ? sales.reduce((s, x) => s + (Number(x.total_amount || x.total_price) || 0), 0)
          : (summaryData.totalSales || 0);

        // 7. Stock movements count
        const totalMovements = Array.isArray(movementsData)
          ? movementsData.length
          : (summaryData.totalMovements || 0);

        // 8. Active alerts count. The alert list endpoint is admin-only, so
        // staff fall back to the public summary's count — otherwise the card
        // shows 0 while 200+ low-stock alerts exist (same pattern as the
        // inquiry/sales cards above).
        const activeAlerts = isStaff
          ? (summaryData.activeAlerts || 0)
          : (Array.isArray(alertsData)
              ? alertsData.filter(a => a.status === 'active' || !a.status).length
              : (summaryData.activeAlerts || 0));

        // 9. This-month sales metrics. Staff use the daily report aggregate
        // (their raw ledger fetch is role-blocked); admins use the ledger.
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let monthlySalesValue = 0;
        let monthlyTransactions = 0;
        if (isStaff && dailySales.length > 0) {
          dailySales.forEach(d => {
            if ((d.date || '').startsWith(thisMonth)) {
              monthlySalesValue += Number(d.value) || 0;
              monthlyTransactions += Number(d.transactions) || 0;
            }
          });
        } else {
          const monthlySales = sales.filter(s => {
            const d = s.transaction_date || s.created_at || '';
            return d.startsWith(thisMonth);
          });
          monthlySalesValue = monthlySales.reduce((s, x) => s + (Number(x.total_amount || x.total_price) || 0), 0);
          monthlyTransactions = monthlySales.length;
        }

        // 10. Unique customers served (all-time). The backend now counts REAL
        // customers — registered accounts that placed an order (customer_id /
        // customer_email). Staff fall back to the public summary (their ledger
        // fetch is role-blocked); admins now prefer the backend's accurate
        // count, falling back to distinct payer names on older payloads.
        const customersServed = isStaff
          ? (summaryData.customersServed || 0)
          : (summaryData.customersServed ||
             new Set(sales.map(s => s.customer_name).filter(Boolean)).size);

        // 10b. The account base: every registered customer account, ordered
        // or not. Admins read it straight off the summary payload; staff (who
        // can't hit the summary) fall back to 0 rather than a wrong number.
        const customersRegistered = isStaff ? 0 : (summaryData.customersRegistered || 0);

        // 11. Order status counts (staff: use the public summary breakdown,
        // same reason as the pending-inquiries card above).
        const inquiries = Array.isArray(inquiriesData) ? inquiriesData : [];
        const summaryStatus = summaryData.orderStatusSummary || {};
        const orderStatusCounts = isStaff
          ? {
              pending: summaryStatus.pending || 0,
              approved: (summaryStatus.approved || 0) + (summaryStatus.fulfilled || 0),
              rejected: (summaryStatus.rejected || 0) + (summaryStatus.cancelled || 0),
            }
          : {
              pending: inquiries.filter(i => i.status === 'pending').length,
              approved: inquiries.filter(i => i.status === 'approved' || i.status === 'fulfilled').length,
              rejected: inquiries.filter(i => i.status === 'rejected' || i.status === 'cancelled').length,
            };

        // 12. Top products by stock value
        const topProductsLive = items.length > 0
          ? items
              .map(item => ({
                id: item.product?.id || item.id,
                name: item.product?.name || item.name || '',
                stock_value: (item.total || 0) * (item.product?.price || item.price || 0)
              }))
              .filter(p => p.stock_value > 0)
              .sort((a, b) => b.stock_value - a.stock_value)
              .slice(0, 5)
          : (summaryData.topProducts || []);

        // 13. Monthly movements for chart
        const monthTypeMapLive = {};
        const movsList = rangeMovements;
        movsList.forEach(m => {
          const month = (m.created_at || '').substring(0, 7);
          if (!month) return;
          const key = `${month}|${m.type}`;
          if (!monthTypeMapLive[key]) monthTypeMapLive[key] = { month, type: m.type, count: 0 };
          monthTypeMapLive[key].count += 1;
        });
        const monthlyMovementsLive = Object.values(monthTypeMapLive).length > 0
          ? Object.values(monthTypeMapLive)
              .sort((a, b) => a.month.localeCompare(b.month))
              .slice(-12)
          : (summaryData.monthlyMovements || []);

        // 14. Fast-moving & slow-moving products (by qty sold). Staff use the
        // summary's ranked lists (their raw ledger fetch is role-blocked).
        let fastMoving = [];
        let slowMoving = [];
        if (isStaff) {
          const fmt = (list) => (list || []).map(p => ({
            name: (p.name || 'Product').length > 20 ? (p.name || 'Product').substring(0, 20) + '…' : (p.name || 'Product'),
            qty: Number(p.qty_sold) || 0,
          }));
          fastMoving = fmt(summaryData.fastMovingProducts).slice(0, 5);
          slowMoving = fmt(summaryData.slowMovingProducts).slice(-5).reverse();
        } else {
          const productSalesMap = {};
          sales.forEach(s => {
            const key = s.product_name || `Product #${s.product_id}`;
            productSalesMap[key] = (productSalesMap[key] || 0) + (Number(s.qty || s.quantity) || 0);
          });
          const sortedBySales = Object.entries(productSalesMap).sort((a, b) => b[1] - a[1]);
          fastMoving = sortedBySales.slice(0, 5).map(([name, qty]) => ({ name: name.length > 20 ? name.substring(0, 20) + '…' : name, qty }));
          slowMoving = sortedBySales.slice(-5).reverse().map(([name, qty]) => ({ name: name.length > 20 ? name.substring(0, 20) + '…' : name, qty }));
        }

        // 15. Available stock per location
        const locationStockMap = {};
        items.forEach(item => {
          Object.entries(item.locations || {}).forEach(([loc, qty]) => {
            locationStockMap[loc] = (locationStockMap[loc] || 0) + Number(qty);
          });
        });
        const locationStock = Object.entries(locationStockMap)
          .map(([location, stock]) => ({ location, stock }))
          .sort((a, b) => b.stock - a.stock);

        // 16. Monthly sales value chart. Staff build it from the daily
        // report rows (their raw ledger fetch is role-blocked).
        let monthlySalesChart = [];
        if (isStaff && dailySales.length > 0) {
          const monthlySalesMapChart = {};
          dailySales.forEach(d => {
            const month = (d.date || '').substring(0, 7);
            if (month) monthlySalesMapChart[month] = (monthlySalesMapChart[month] || 0) + (Number(d.value) || 0);
          });
          monthlySalesChart = Object.entries(monthlySalesMapChart)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-12)
            .map(([month, value]) => ({ month, value: Math.round(value) }));
        } else {
          const monthlySalesMapChart = {};
          sales.forEach(s => {
            const month = (s.transaction_date || s.created_at || '').substring(0, 7);
            if (month) monthlySalesMapChart[month] = (monthlySalesMapChart[month] || 0) + (Number(s.total_amount || s.total_price) || 0);
          });
          monthlySalesChart = Object.entries(monthlySalesMapChart)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-12)
            .map(([month, value]) => ({ month, value: Math.round(value) }));
        }

        setSummary({
          totalProducts, totalStock, lowStockItems: lowStockCount, totalLocations,
          pendingInquiries, totalSales, totalMovements, activeAlerts,
          monthlySalesValue, monthlyTransactions, customersServed, customersRegistered, orderStatusCounts,
          topProducts: topProductsLive,
          monthlyMovements: monthlyMovementsLive,
          fastMoving, slowMoving, locationStock, monthlySalesChart,
        });
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

  const handleCardClick = (panel) => {
    setActiveModal(panel);
    setModalLoading(false);
    setSearchQuery('');

    const { inventory, sales, inquiries, movements, products, alerts, summary, dailySales, accounts } = rawData;

    if (panel.key === 'lowStock') {
      const lowEntries = [];
      inventory.forEach(item => {
        if (item.locations) {
          Object.entries(item.locations).forEach(([locName, qty]) => {
            if (Number(qty) < 80) {
              lowEntries.push({
                id: `${item.product?.id || item.name}-${locName}`,
                product_name: item.product?.name || item.name,
                category: item.product?.category || 'General',
                location: locName,
                quantity: qty,
              });
            }
          });
        }
      });
      setModalData(lowEntries);
    } else if (panel.key === 'products') {
      setModalData(products);
    } else if (panel.key === 'inventory') {
      setModalData(inventory);
    } else if (panel.key === 'locationStock') {
      // Aggregate total stock per location (not per product)
      const locationTotals = {};
      inventory.forEach(item => {
        Object.entries(item.locations || {}).forEach(([loc, qty]) => {
          locationTotals[loc] = (locationTotals[loc] || 0) + Number(qty);
        });
      });
      const rows = Object.entries(locationTotals)
        .map(([loc, total]) => ({ id: loc, location: loc, total_stock: total }))
        .sort((a, b) => b.total_stock - a.total_stock);
      setModalData(rows);
    } else if (panel.key === 'inquiries') {
      setModalData(inquiries.filter(i => i.status === 'pending'));
    } else if (panel.key === 'orderStatus') {
      setModalData(inquiries);
    } else if (panel.key === 'sales') {
      setModalData(sales);
    } else if (panel.key === 'monthlySales') {
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (sales.length > 0) {
        setModalData(sales.filter(s => (s.transaction_date || s.created_at || '').startsWith(thisMonth)));
      } else if (dailySales.length > 0) {
        // Staff cannot read the raw ledger; show this month's daily report
        // rows (same data the card totals) as a compact table.
        setModalData(
          dailySales
            .filter(d => (d.date || '').startsWith(thisMonth))
            .map(d => ({ id: d.date, product_name: `${d.transactions} transaction(s)`, qty: d.transactions, total_amount: d.value, transaction_date: d.date, customer_name: '—' }))
        );
      } else {
        setModalData([]);
      }
    } else if (panel.key === 'customers') {
      // Account-based like the card: distinct submitters from the inquiries
      // payload (email identifies the account; name is the display name).
      // Walk-in payer names from the sales ledger are intentionally NOT
      // listed here anymore. Rows arrive newest-first, so the first hit per
      // customer carries their latest status.
      const byCustomer = {};
      inquiries.forEach(i => {
        const key = (i.customer_email || i.customer_name || '').toLowerCase();
        if (!key) return;
        if (!byCustomer[key]) {
          byCustomer[key] = {
            id: key,
            customer_name: i.customer_name || 'Customer',
            customer_email: i.customer_email || '—',
            orders: 0,
            latest_status: i.status || 'pending',
          };
        }
        byCustomer[key].orders += 1;
      });
      setModalData(Object.values(byCustomer).sort((a, b) => b.orders - a.orders));
    } else if (panel.key === 'customersRegistered') {
      // The account base — straight from the Users API.
      setModalData(accounts);
    } else if (panel.key === 'movements') {
      setModalData(movements);
    } else if (panel.key === 'fastMoving') {
      if (sales.length > 0) {
        const productSalesMap = {};
        sales.forEach(s => {
          const key = s.product_name || `Product #${s.product_id}`;
          if (!productSalesMap[key]) productSalesMap[key] = { product_name: key, qty: 0, revenue: 0 };
          productSalesMap[key].qty += Number(s.qty || s.quantity) || 0;
          productSalesMap[key].revenue += Number(s.total_amount || s.total_price) || 0;
        });
        setModalData(Object.values(productSalesMap).sort((a, b) => b.qty - a.qty).slice(0, 10));
      } else {
        // Staff fall back to the public summary's ranked list.
        setModalData(((summary && summary.fastMovingProducts) || []).map(p => ({ product_name: p.name, qty: Number(p.qty_sold) || 0, revenue: Number(p.value) || 0 })));
      }
    } else if (panel.key === 'slowMoving') {
      if (sales.length > 0) {
        const productSalesMap = {};
        sales.forEach(s => {
          const key = s.product_name || `Product #${s.product_id}`;
          if (!productSalesMap[key]) productSalesMap[key] = { product_name: key, qty: 0, revenue: 0 };
          productSalesMap[key].qty += Number(s.qty || s.quantity) || 0;
          productSalesMap[key].revenue += Number(s.total_amount || s.total_price) || 0;
        });
        setModalData(Object.values(productSalesMap).sort((a, b) => a.qty - b.qty).slice(0, 10));
      } else {
        setModalData(((summary && summary.slowMovingProducts) || []).map(p => ({ product_name: p.name, qty: Number(p.qty_sold) || 0, revenue: Number(p.value) || 0 })));
      }
    } else if (panel.key === 'alerts') {
      // Real alerts (admin) or, when the alert list is role-blocked/empty, the
      // low-stock entries from inventory — never stock movements masquerading
      // as alerts. Staff get the low-stock fallback since /api/alerts is
      // admin-only; the card's count (summary.activeAlerts) matches the
      // low-stock threshold on both roles.
      if (alerts.length > 0) {
        setModalData(
          alerts
            .filter(a => a.status === 'active' || !a.status)
            .map(a => {
              // Expiry alerts carry the best-before date + days remaining in
              // `threshold`; low-stock alerts keep the qty-below-level shape.
              const isExpiry = a.alert_type === 'expiring_soon' || a.alert_type === 'expired';
              const message = isExpiry
                ? `${a.product_name || `Product #${a.product_id}`} at ${a.location_name || 'a location'} — ${a.current_qty} units ${a.alert_type === 'expired' ? 'already EXPIRED' : `expire in ${a.threshold} day${a.threshold === 1 ? '' : 's'}`} (best before ${a.expiry_date || 'unknown'})`
                : `${a.product_name || `Product #${a.product_id}`} at ${a.location_name || 'a location'} — ${a.current_qty} units below ${a.threshold ?? 80}`;
              return {
                id: a.id,
                type: a.alert_type || 'low_stock',
                expiry_date: a.expiry_date || null,
                message,
                created_at: a.created_at,
              };
            })
        );
      } else {
        const lowEntries = [];
        inventory.forEach(item => {
          if (item.locations) {
            Object.entries(item.locations).forEach(([locName, qty]) => {
              if (Number(qty) < 80) {
                lowEntries.push({
                  id: `${item.product?.id || item.name}-${locName}`,
                  type: 'low_stock',
                  message: `${item.product?.name || item.name} at ${locName} — ${qty} units below 80`,
                  created_at: null,
                });
              }
            });
          }
        });
        setModalData(lowEntries);
      }
    }
  };

  // Section 1 — Inventory Analytics (dynamically filtered by inventoryRange)
  const invRange = useMemo(() => resolveRange(inventoryRange), [inventoryRange]);
  const productValueData = useMemo(() => {
    const products = rawData.products || [];
    let list = products
      .map(item => ({
        name: item.name || '',
        value: Math.round((Number(item.price) || 0) * (Number(item.stock || item.quantity || item.total) || 0))
      }))
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    if (list.length === 0 && summary.topProducts) {
      list = summary.topProducts.map(p => ({
        name: p.name?.length > 15 ? p.name.substring(0, 15) + '…' : p.name,
        value: Math.round(p.stock_value)
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
      isWithinRange(s.transaction_date || s.created_at || s.date, velRange)
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
      isWithinRange(s.transaction_date || s.created_at || s.date, soRange)
    );
    const inquiries = (rawData.inquiries || []).filter(i =>
      isWithinRange(i.created_at || i.date, soRange)
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
      isWithinRange(m.created_at || m.transaction_date || m.date, movRange)
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

  const ORDER_STATUS_COLORS = ['#f9a825', '#1f640e', '#d32f2f'];

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

  const filteredModalData = modalData.filter(item => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.product_name && item.product_name.toLowerCase().includes(q)) ||
      (item.location && item.location.toLowerCase().includes(q)) ||
      (item.product?.name && item.product.name.toLowerCase().includes(q)) ||
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.customer_name && item.customer_name.toLowerCase().includes(q)) ||
      (item.type && item.type.toLowerCase().includes(q)) ||
      (item.message && item.message.toLowerCase().includes(q)) ||
      (item.status && item.status.toLowerCase().includes(q))
    );
  });

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

  const SectionLabel = ({ children, rangeValue, onRangeChange }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5, mt: 3.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.2, fontSize: '0.78rem' }}>
        {children}
      </Typography>
      {onRangeChange && (
        <RangeFilter value={rangeValue} onChange={onRangeChange} compact />
      )}
    </Box>
  );

  const NoData = ({ msg }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <Typography color="text.secondary" variant="body2">{msg || 'No data available yet'}</Typography>
    </Box>
  );

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
                maskLabel={isMasked ? "Executive Only" : ""}
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

      {/* ─── Charts Row 1: Stock value + Stock per location (Live Point-in-Time) ─── */}
      <SectionLabel>Inventory Analytics</SectionLabel>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Top Products by Stock Value</Typography>
            {!isExecutive ? (
              <NoData msg="🔒 Executive Access Required (Owner / Super Admin Only)" />
            ) : productValueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={productValueData} margin={{ bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `P${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip formatter={(val) => [`P${val.toLocaleString()}`, 'Stock Value']} />
                  <Bar dataKey="value" name="Stock Value" fill={colors.brandPrimary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No inventory data available" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Available Stock per Location</Typography>
            {locationStockData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={locationStockData} margin={{ bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="location" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip formatter={(val) => [val.toLocaleString(), 'Units']} />
                  <Bar dataKey="stock" name="Total Stock" fill={colors.brandSecondary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No location stock data" />}
          </Paper>
        </Grid>
      </Grid>

      {/* ─── Charts Row 2: Fast-moving + Slow-moving ─── */}
      <SectionLabel rangeValue={velocityRange} onRangeChange={setVelocityRange}>
        Product Sales Velocity
      </SectionLabel>
      {/* Same FSN ranking logic as Optimization → FSN, summarized for the
          dashboard's top-5 / bottom-5 charts. */}
      <FormulaBanner
        dense
        title="Velocity ranking (FSN basis)"
        items={[
          'units sold = Σ qty per product inside the range   ·   rank DESC → top 5 = Fast   ·   rank ASC → bottom 5 = Slow',
          'Full F/S/N classification (frequency & recency) lives on the Optimization page.',
        ]}
      />
      <Grid container spacing={3} sx={{ mt: 0.25 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TrendingUpIcon sx={{ color: FAST_COLOR }} />
              <Typography variant="h6" fontWeight={700}>Fast-Moving Products</Typography>
              <Chip label="Top 5" size="small" sx={{ backgroundColor: colors.brandAccent, fontWeight: 600 }} />
            </Box>
            {fastMovingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={fastMovingData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <RechartsTooltip formatter={(val) => [val, 'Units Sold']} />
                  <Bar dataKey="qty" name="Units Sold" fill={FAST_COLOR} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No sales data yet" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TrendingDownIcon sx={{ color: SLOW_COLOR }} />
              <Typography variant="h6" fontWeight={700}>Slow-Moving Products</Typography>
              <Chip label="Bottom 5" size="small" sx={{ backgroundColor: '#fff8e1', fontWeight: 600 }} />
            </Box>
            {slowMovingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={slowMovingData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <RechartsTooltip formatter={(val) => [val, 'Units Sold']} />
                  <Bar dataKey="qty" name="Units Sold" fill={SLOW_COLOR} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No sales data yet" />}
          </Paper>
        </Grid>
      </Grid>

      {/* ─── Charts Row 3: Monthly Sales + Order Status ─── */}
      <SectionLabel rangeValue={salesOrdersRange} onRangeChange={setSalesOrdersRange}>
        Sales & Orders Analytics
      </SectionLabel>
      {/* Monthly chart = the same Σ grouped by YYYY-MM the Reports page's
          daily table totals; the pie is a straight status count. */}
      <FormulaBanner
        dense
        title="Chart math"
        items={[
          'Monthly Sales = Σ total_amount grouped by month (YYYY-MM)   ·   Order Status = COUNT(inquiries) per status',
          'Both inherit the section Days / Weeks / Months / Quarterly / Annually filter.',
        ]}
      />
      <Grid container spacing={3} sx={{ mt: 0.25 }}>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Monthly Sales Value</Typography>
            {!isExecutive ? (
              <NoData msg="🔒 Executive Access Required (Owner / Super Admin Only)" />
            ) : monthlySalesChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlySalesChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `P${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip formatter={(val) => [`P${val.toLocaleString()}`, 'Sales']} />
                  <Line type="monotone" dataKey="value" name="Sales Value" stroke={colors.brandPrimary} strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <NoData msg="No sales data available" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Order Status Summary</Typography>
            {isStaffRole ? (
              <NoData msg="🔒 Admin / Executive Access Required" />
            ) : orderStatusPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={orderStatusPieData}
                    cx="50%" cy="50%" outerRadius={90} innerRadius={45}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {orderStatusPieData.map((entry, i) => (
                      <Cell key={i} fill={ORDER_STATUS_COLORS[i % ORDER_STATUS_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(val, name) => [val, name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary" variant="body2">No order inquiries yet</Typography>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* ─── Charts Row 4: Movement distribution + Monthly trends ─── */}
      <SectionLabel rangeValue={movementRange} onRangeChange={setMovementRange}>
        Stock Movement Analytics
      </SectionLabel>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Stock Movement Distribution</Typography>
            {movementChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Stock In', value: movementChartData.reduce((s, m) => s + m['stock-in'], 0) },
                      { name: 'Stock Out', value: movementChartData.reduce((s, m) => s + m['stock-out'], 0) },
                      { name: 'Transfer', value: movementChartData.reduce((s, m) => s + m.transfer, 0) },
                      { name: 'Adjustment', value: movementChartData.reduce((s, m) => s + m.adjustment, 0) },
                    ].filter(d => d.value > 0)}
                    cx="50%" cy="50%" outerRadius={90} innerRadius={40}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {CHART_COLORS.map((color, i) => <Cell key={i} fill={color} />)}
                  </Pie>
                  <RechartsTooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <NoData msg="No movement data yet — record stock-in/out to see distribution" />}
          </Paper>
        </Grid>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, borderRadius: 3 }}>
            <Typography variant="h6" mb={2} fontWeight={700}>Monthly Movement Trends</Typography>
            {movementChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={movementChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,60,18,0.08)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey="stock-in" name="Stock In" fill={colors.brandPrimary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="stock-out" name="Stock Out" fill={colors.error} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="transfer" name="Transfer" fill={colors.info} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData msg="No movement data yet — record stock movements to see trends" />}
          </Paper>
        </Grid>
      </Grid>

      {/* ─── Detailed Items Modal ─── */}
      <Dialog
        open={Boolean(activeModal)}
        onClose={() => setActiveModal(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, p: 1 } }}
      >
        {activeModal && (
          <>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {activeModal.icon}
                <Typography variant="h6" fontWeight={700}>{activeModal.label}</Typography>
                <Chip
                  label={`${filteredModalData.length} items`}
                  size="small"
                  color={activeModal.key === 'lowStock' ? 'warning' : 'default'}
                  sx={{ fontWeight: 600 }}
                />
              </Box>
              <IconButton onClick={() => setActiveModal(null)} size="small"><CloseIcon /></IconButton>
            </DialogTitle>

            <DialogContent dividers>
              <Box sx={{ mb: 2 }}>
                <TextField                   placeholder="Search items…"
                  size="small" fullWidth
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                    ),
                  }}
                />
              </Box>

              {modalLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>
              ) : filteredModalData.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 5 }}>
                  <Typography color="text.secondary">No items found matching your request.</Typography>
                </Box>
              ) : (
                <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: colors.surfaceAlt }}>
                      <TableRow>
                        {activeModal.key === 'lowStock' && (
                          <>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell><strong>Category</strong></TableCell>
                            <TableCell><strong>Location</strong></TableCell>
                            <TableCell align="right"><strong>Qty in Location</strong></TableCell>
                            <TableCell align="center"><strong>Status</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'products' && (
                          <>
                            <TableCell><strong>Product Name</strong></TableCell>
                            <TableCell><strong>Category</strong></TableCell>
                            <TableCell><strong>Size</strong></TableCell>
                            <TableCell align="right"><strong>Price</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'inventory' && (
                          <>
                            <TableCell><strong>Product Name</strong></TableCell>
                            <TableCell><strong>Locations</strong></TableCell>
                            <TableCell align="right"><strong>Total Stock</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'locationStock' && (
                          <>
                            <TableCell><strong>Location</strong></TableCell>
                            <TableCell align="right"><strong>Total Stock</strong></TableCell>
                          </>
                        )}
                        {(activeModal.key === 'inquiries' || activeModal.key === 'orderStatus') && (
                          <>
                            <TableCell><strong>Inquiry ID</strong></TableCell>
                            <TableCell><strong>Customer</strong></TableCell>
                            <TableCell align="right"><strong>Estimated Total</strong></TableCell>
                            <TableCell align="center"><strong>Status</strong></TableCell>
                          </>
                        )}
                        {(activeModal.key === 'sales' || activeModal.key === 'monthlySales') && (
                          <>
                            <TableCell><strong>Sale ID</strong></TableCell>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell><strong>Customer</strong></TableCell>
                            <TableCell align="right"><strong>Qty</strong></TableCell>
                            <TableCell align="right"><strong>Total Amount</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'customers' && (
                          <>
                            <TableCell><strong>Customer</strong></TableCell>
                            <TableCell><strong>Email</strong></TableCell>
                            <TableCell align="right"><strong>Orders</strong></TableCell>
                            <TableCell align="center"><strong>Latest Status</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'customersRegistered' && (
                          <>
                            <TableCell><strong>Username</strong></TableCell>
                            <TableCell><strong>Email</strong></TableCell>
                            <TableCell align="center"><strong>Verified</strong></TableCell>
                            <TableCell><strong>Joined</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'movements' && (
                          <>
                            <TableCell><strong>ID</strong></TableCell>
                            <TableCell><strong>Type</strong></TableCell>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell align="right"><strong>Quantity</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                          </>
                        )}
                        {(activeModal.key === 'fastMoving' || activeModal.key === 'slowMoving') && (
                          <>
                            <TableCell><strong>Product</strong></TableCell>
                            <TableCell align="right"><strong>Units Sold</strong></TableCell>
                            <TableCell align="right"><strong>Revenue</strong></TableCell>
                          </>
                        )}
                        {activeModal.key === 'alerts' && (
                          <>
                            <TableCell><strong>Alert ID</strong></TableCell>
                            <TableCell><strong>Type</strong></TableCell>
                            <TableCell><strong>Description</strong></TableCell>
                            <TableCell><strong>Best Before</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                          </>
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredModalData.map((item, idx) => (
                        <TableRow key={item.id || idx} hover>
                          {activeModal.key === 'lowStock' && (
                            <>
                              <TableCell><strong>{item.product_name}</strong></TableCell>
                              <TableCell>{item.category}</TableCell>
                              <TableCell>{item.location}</TableCell>
                              <TableCell align="right">
                                <Typography color="warning.main" fontWeight={700}>{item.quantity}</Typography>
                              </TableCell>
                              <TableCell align="center"><Chip label="LOW STOCK" size="small" color="warning" /></TableCell>
                            </>
                          )}
                          {activeModal.key === 'products' && (
                            <>
                              <TableCell><strong>{item.name}</strong></TableCell>
                              <TableCell>{item.category || 'General'}</TableCell>
                              <TableCell>{item.size || '—'}</TableCell>
                              <TableCell align="right">P{item.price ? Number(item.price).toLocaleString() : 0}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'inventory' && (
                            <>
                              <TableCell><strong>{item.product?.name || item.name}</strong></TableCell>
                              <TableCell>
                                {item.locations
                                  ? Object.entries(item.locations).map(([l, q]) => `${l}: ${q}`).join(' · ')
                                  : 'N/A'}
                              </TableCell>
                              <TableCell align="right"><strong>{item.total ?? 0}</strong></TableCell>
                            </>
                          )}
                          {activeModal.key === 'locationStock' && (
                            <>
                              <TableCell><strong>{item.location}</strong></TableCell>
                              <TableCell align="right"><strong>{item.total_stock?.toLocaleString()}</strong></TableCell>
                            </>
                          )}
                          {(activeModal.key === 'inquiries' || activeModal.key === 'orderStatus') && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell><strong>{item.customer_name || 'Customer'}</strong></TableCell>
                              <TableCell align="right">P{item.total_estimated_cost ? Number(item.total_estimated_cost).toLocaleString() : 0}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={item.status || 'pending'}
                                  size="small"
                                  color={item.status === 'approved' || item.status === 'fulfilled' ? 'success' : item.status === 'rejected' || item.status === 'cancelled' ? 'error' : 'warning'}
                                />
                              </TableCell>
                            </>
                          )}
                          {(activeModal.key === 'sales' || activeModal.key === 'monthlySales') && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell><strong>{item.product_name || `Product #${item.product_id}`}</strong></TableCell>
                              <TableCell>{item.customer_name || '—'}</TableCell>
                              <TableCell align="right">{item.qty ?? item.quantity ?? '—'}</TableCell>
                              <TableCell align="right">
                                {!moneyVisible
                                  ? MONEY_MASK
                                  : item.total_amount != null
                                    ? `P${Number(item.total_amount).toLocaleString()}`
                                    : item.total_price != null
                                      ? `P${Number(item.total_price).toLocaleString()}`
                                      : '—'}
                              </TableCell>
                              <TableCell>{item.transaction_date ? new Date(item.transaction_date).toLocaleDateString() : (item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A')}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'customers' && (
                            <>
                              <TableCell><strong>{item.customer_name}</strong></TableCell>
                              <TableCell>{item.customer_email}</TableCell>
                              <TableCell align="right">{item.orders}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={item.latest_status || 'pending'}
                                  size="small"
                                  color={item.latest_status === 'approved' || item.latest_status === 'fulfilled' ? 'success' : item.latest_status === 'rejected' || item.latest_status === 'cancelled' ? 'error' : 'warning'}
                                />
                              </TableCell>
                            </>
                          )}
                          {activeModal.key === 'customersRegistered' && (
                            <>
                              <TableCell><strong>{item.username}</strong></TableCell>
                              <TableCell>{item.email || '—'}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={item.email_verified === false ? 'Unverified' : 'Verified'}
                                  size="small"
                                  color={item.email_verified === false ? 'warning' : 'success'}
                                />
                              </TableCell>
                              <TableCell>{item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'movements' && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell>
                                <Chip
                                  label={item.type || 'movement'} size="small"
                                  color={item.type === 'stock-in' ? 'success' : item.type === 'stock-out' ? 'error' : 'info'}
                                />
                              </TableCell>
                              <TableCell><strong>{item.product_name || `Product #${item.product_id}`}</strong></TableCell>
                              <TableCell align="right">{item.quantity}</TableCell>
                              <TableCell>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</TableCell>
                            </>
                          )}
                          {(activeModal.key === 'fastMoving' || activeModal.key === 'slowMoving') && (
                            <>
                              <TableCell><strong>{item.product_name}</strong></TableCell>
                              <TableCell align="right">{item.qty.toLocaleString()}</TableCell>
                              <TableCell align="right">P{Number(item.revenue).toLocaleString()}</TableCell>
                            </>
                          )}
                          {activeModal.key === 'alerts' && (
                            <>
                              <TableCell>#{item.id}</TableCell>
                              <TableCell>
                                <Chip
                                  label={item.type === 'expired' ? 'Expired' : item.type === 'expiring_soon' ? 'Expiring Soon' : item.type || 'Alert'}
                                  size="small"
                                  color={item.type === 'expired' ? 'error' : item.type === 'expiring_soon' ? 'warning' : 'error'}
                                />
                              </TableCell>
                              <TableCell>{item.message || item.description || 'Inventory threshold breach'}</TableCell>
                              <TableCell>{item.expiry_date || '—'}</TableCell>
                              <TableCell>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}</TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </DialogContent>

            <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
              <Button color="inherit" onClick={() => setActiveModal(null)}>Close</Button>
              <Button
                variant="contained" color="primary"
                endIcon={<OpenInNewIcon />}
                onClick={() => {
                  const target = activeModal.navigateTo;
                  setActiveModal(null);
                  navigate(target);
                }}
              >
                Go to full page
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

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

// ─── Reusable stat card component with Motion Primitives-style animation ───
function StatCard({ panel, loading, onClick, index = 0, masked = false, maskLabel = 'Executive Access Only' }) {
  // `masked` renders the placeholder for roles without financial or executive
  // visibility.
  const display = masked ? MONEY_MASK : panel.value;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: 'easeOut' }}
      whileHover={{ y: -4, boxShadow: '0 12px 32px rgba(0,0,0,0.15)' }}
      whileTap={{ scale: 0.98 }}
      style={{ height: '100%' }}
    >
      <Tooltip title={masked ? `Restricted: ${maskLabel}` : "Click to view detailed item list"} arrow placement="top">
        <LiquidGlassCard intensity="low" color="rgba(255, 255, 255, 0.05)">
        <Paper
          onClick={() => !masked && onClick(panel)}
          onKeyDown={(e) => { if (!masked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(panel); } }}
          tabIndex={masked ? -1 : 0}
          role="button"
          aria-label={`${panel.label}: ${loading ? 'loading' : display}.`}
          sx={{
            p: 2.5,
            height: '100%',
            backgroundColor: masked ? 'rgba(245, 245, 245, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            borderRadius: 3,
            borderLeft: `4px solid ${masked ? '#9e9e9e' : panel.color}`,
            cursor: masked ? 'default' : 'pointer',
            transition: 'box-shadow 0.2s ease-in-out',
            backdropFilter: 'blur(8px)',
            '&:focus-visible': {
              outline: '2px solid #1f640e',
              outlineOffset: '2px',
            },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5, fontSize: '0.72rem' }}>
              {panel.label}
            </Typography>
            <motion.div
              whileHover={{ rotate: 10, scale: 1.2 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              <Box sx={{ color: 'text.secondary', opacity: 0.5 }} aria-hidden="true">{panel.icon}</Box>
            </motion.div>
          </Box>
          <Typography variant="h5" color={masked ? 'text.secondary' : 'text.primary'} sx={{ fontWeight: 700 }}>
            {loading ? '…' : masked ? (
              <Box component="span" sx={{ letterSpacing: '0.15em', opacity: 0.65 }}>{panel.prefix ? `${panel.prefix} ***,***` : '***'}</Box>
            ) : (
              <AnimatedCounter
                target={panel.numericValue ?? 0}
                prefix={panel.prefix || ''}
                suffix={panel.suffix || ''}
                duration={700}
              />
            )}
          </Typography>
          <Typography variant="caption" color={masked ? 'text.secondary' : 'primary'} sx={{ display: 'inline-block', mt: 0.5, fontWeight: 500, opacity: 0.85 }}>
            {masked ? `🔒 ${maskLabel || 'Restricted'}` : 'Click to inspect →'}
          </Typography>
        </Paper>
        </LiquidGlassCard>
      </Tooltip>
    </motion.div>
  );
}

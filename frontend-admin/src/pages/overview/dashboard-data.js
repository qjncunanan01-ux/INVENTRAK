import { isWithinRange } from '../../dateRange';

// Pure derivation for the Dashboard. Takes the raw API payloads the page
// fetched (plus the staff/dailySales context) and returns the normalised
// `rawData` the modals read and the `summary` the cards/charts render. Extracted
// from DashboardPage's load effect so the effect is just fetch + setState, and
// so every metric rule can be read in one place without React in the way.
export function deriveDashboard({
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
}) {
  // Alert list fetch is admin-only (staff get 403, handled by allSettled) —
  // the staff dashboard falls back to the low-stock entries it can read from
  // inventory instead.
  const rawAlerts = Array.isArray(alertsData) ? alertsData : [];

  // Apply the selected date range to the ledger rows. Everything derived from
  // sales/movements below (totals, this-month KPIs, velocity charts, monthly
  // charts) inherits the filter automatically.
  const inRange = (rows) =>
    (Array.isArray(rows) ? rows : []).filter((r) =>
      isWithinRange(r.transaction_date || r.created_at || r.date, range),
    );
  const rangeSales = inRange(salesData);
  const rangeMovements = inRange(movementsData);

  const rawData = {
    inventory: items,
    sales: rangeSales,
    inquiries: Array.isArray(inquiriesData) ? inquiriesData : [],
    movements: rangeMovements,
    products: Array.isArray(productsData) ? productsData : [],
    alerts: rawAlerts,
    accounts: Array.isArray(accountsData) ? accountsData : [],
    // Staff-visible fallbacks the detail modals reuse so a card's value and
    // its modal never disagree (same source the cards count from).
    summary: summaryData,
    dailySales,
  };

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
    : (summaryData.totalLocations || 0);

  // 5. Pending inquiries count. Staff GET /api/order-inquiries is scoped to
  // their own account (always empty), so their dashboard must fall back to the
  // public summary count — otherwise the card would show 0 while orders are
  // actually pending.
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

  // 8. Active alerts count. The alert list endpoint is admin-only, so staff
  // fall back to the public summary's count — otherwise the card shows 0 while
  // 200+ low-stock alerts exist (same pattern as the inquiry/sales cards).
  const activeAlerts = isStaff
    ? (summaryData.activeAlerts || 0)
    : (Array.isArray(alertsData)
      ? alertsData.filter(a => a.status === 'active' || !a.status).length
      : (summaryData.activeAlerts || 0));

  // 9. This-month sales metrics. Staff use the daily report aggregate (their
  // raw ledger fetch is role-blocked); admins use the ledger.
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

  // 10. Unique customers served (all-time). The backend counts REAL customers
  // — registered accounts that placed an order. Staff fall back to the public
  // summary (their ledger fetch is role-blocked); admins prefer the backend's
  // accurate count, falling back to distinct payer names on older payloads.
  const customersServed = isStaff
    ? (summaryData.customersServed || 0)
    : (summaryData.customersServed ||
       new Set(sales.map(s => s.customer_name).filter(Boolean)).size);

  // 10b. The account base: every registered customer account, ordered or not.
  const customersRegistered = isStaff ? 0 : (summaryData.customersRegistered || 0);

  // 11. Order status counts (staff: use the public summary breakdown).
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
  const topProducts = items.length > 0
    ? items
      .map(item => ({
        id: item.product?.id || item.id,
        name: item.product?.name || item.name || '',
        stock_value: (item.total || 0) * (item.product?.price || item.price || 0),
      }))
      .filter(p => p.stock_value > 0)
      .sort((a, b) => b.stock_value - a.stock_value)
      .slice(0, 5)
    : (summaryData.topProducts || []);

  // 13. Monthly movements for chart
  const monthTypeMapLive = {};
  rangeMovements.forEach(m => {
    const month = (m.created_at || '').substring(0, 7);
    if (!month) return;
    const key = `${month}|${m.type}`;
    if (!monthTypeMapLive[key]) monthTypeMapLive[key] = { month, type: m.type, count: 0 };
    monthTypeMapLive[key].count += 1;
  });
  const monthlyMovements = Object.values(monthTypeMapLive).length > 0
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

  // 16. Monthly sales value chart. Staff build it from the daily report rows
  // (their raw ledger fetch is role-blocked).
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

  const summary = {
    totalProducts, totalStock, lowStockItems: lowStockCount, totalLocations,
    pendingInquiries, totalSales, totalMovements, activeAlerts,
    monthlySalesValue, monthlyTransactions, customersServed, customersRegistered, orderStatusCounts,
    topProducts,
    monthlyMovements,
    fastMoving, slowMoving, locationStock, monthlySalesChart,
  };

  return { rawData, summary };
}

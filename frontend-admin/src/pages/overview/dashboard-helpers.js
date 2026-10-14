// Pure derivation helpers for the Dashboard. Extracted from DashboardPage so
// the page body reads as orchestration; because these take plain data in and
// return plain rows out, they can be reasoned about (and tested) without React.

// Rows for the detail modal behind a clicked stat card. One branch per panel
// key; unknown keys return no rows rather than leaving stale data behind.
export function buildModalData(panel, rawData) {
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
    return lowEntries;
  }
  if (panel.key === 'products') return products;
  if (panel.key === 'inventory') return inventory;
  if (panel.key === 'locationStock') {
    // Aggregate total stock per location (not per product)
    const locationTotals = {};
    inventory.forEach(item => {
      Object.entries(item.locations || {}).forEach(([loc, qty]) => {
        locationTotals[loc] = (locationTotals[loc] || 0) + Number(qty);
      });
    });
    return Object.entries(locationTotals)
      .map(([loc, total]) => ({ id: loc, location: loc, total_stock: total }))
      .sort((a, b) => b.total_stock - a.total_stock);
  }
  if (panel.key === 'inquiries') return inquiries.filter(i => i.status === 'pending');
  if (panel.key === 'orderStatus') return inquiries;
  if (panel.key === 'sales') return sales;
  if (panel.key === 'monthlySales') {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (sales.length > 0) {
      return sales.filter(s => (s.transaction_date || s.created_at || '').startsWith(thisMonth));
    }
    if (dailySales.length > 0) {
      // Staff cannot read the raw ledger; show this month's daily report
      // rows (same data the card totals) as a compact table.
      return dailySales
        .filter(d => (d.date || '').startsWith(thisMonth))
        .map(d => ({ id: d.date, product_name: `${d.transactions} transaction(s)`, qty: d.transactions, total_amount: d.value, transaction_date: d.date, customer_name: '—' }));
    }
    return [];
  }
  if (panel.key === 'customers') {
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
    return Object.values(byCustomer).sort((a, b) => b.orders - a.orders);
  }
  if (panel.key === 'customersRegistered') {
    // The account base — straight from the Users API.
    return accounts;
  }
  if (panel.key === 'movements') return movements;
  if (panel.key === 'fastMoving') {
    if (sales.length > 0) {
      const productSalesMap = {};
      sales.forEach(s => {
        const key = s.product_name || `Product #${s.product_id}`;
        if (!productSalesMap[key]) productSalesMap[key] = { product_name: key, qty: 0, revenue: 0 };
        productSalesMap[key].qty += Number(s.qty || s.quantity) || 0;
        productSalesMap[key].revenue += Number(s.total_amount || s.total_price) || 0;
      });
      return Object.values(productSalesMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
    }
    // Staff fall back to the public summary's ranked list.
    return ((summary && summary.fastMovingProducts) || []).map(p => ({ product_name: p.name, qty: Number(p.qty_sold) || 0, revenue: Number(p.value) || 0 }));
  }
  if (panel.key === 'slowMoving') {
    if (sales.length > 0) {
      const productSalesMap = {};
      sales.forEach(s => {
        const key = s.product_name || `Product #${s.product_id}`;
        if (!productSalesMap[key]) productSalesMap[key] = { product_name: key, qty: 0, revenue: 0 };
        productSalesMap[key].qty += Number(s.qty || s.quantity) || 0;
        productSalesMap[key].revenue += Number(s.total_amount || s.total_price) || 0;
      });
      return Object.values(productSalesMap).sort((a, b) => a.qty - b.qty).slice(0, 10);
    }
    return ((summary && summary.slowMovingProducts) || []).map(p => ({ product_name: p.name, qty: Number(p.qty_sold) || 0, revenue: Number(p.value) || 0 }));
  }
  if (panel.key === 'alerts') {
    // Real alerts (admin) or, when the alert list is role-blocked/empty, the
    // low-stock entries from inventory — never stock movements masquerading
    // as alerts.
    if (alerts.length > 0) {
      return alerts
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
        });
    }
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
    return lowEntries;
  }
  return [];
}

// Free-text filter applied to the modal's rows across every row shape.
export function filterModalData(modalData, searchQuery) {
  if (!searchQuery) return modalData;
  const q = searchQuery.toLowerCase();
  return modalData.filter(item => (
    (item.product_name && item.product_name.toLowerCase().includes(q)) ||
    (item.location && item.location.toLowerCase().includes(q)) ||
    (item.product?.name && item.product.name.toLowerCase().includes(q)) ||
    (item.name && item.name.toLowerCase().includes(q)) ||
    (item.customer_name && item.customer_name.toLowerCase().includes(q)) ||
    (item.type && item.type.toLowerCase().includes(q)) ||
    (item.message && item.message.toLowerCase().includes(q)) ||
    (item.status && item.status.toLowerCase().includes(q))
  ));
}

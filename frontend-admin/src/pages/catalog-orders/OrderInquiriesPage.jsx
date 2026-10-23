import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPut } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

const STATUS_COLORS = {
  pending: 'warning',
  approved: 'info',
  preparing: 'info',
  fulfilled: 'success',
  delivered: 'success',
  rejected: 'error',
  // Customer-initiated cancellation — a neutral state, not a failure: the
  // customer changed their mind. Red would read as "the business rejected it".
  cancelled: 'default',
};

const STATUS_FILTERS = [
  { key: '', label: 'All statuses' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

// How the customer asked to receive the order. A preference only — nothing in
// this system books a courier.
const FULFILLMENT_LABELS = { pickup: 'PICKUP', courier: 'COURIER' };

// Parse an order's stored products JSON into an array of line items.
// Handles the structured lines ({ name, qty, price, original_price, ... })
// the app now records AND legacy plain-string entries ('Widget x2').
function parseLines(order) {
  if (Array.isArray(order.products_detail)) return order.products_detail;
  try {
    const parsed = JSON.parse(order.products || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// One line's price (unit price actually charged — deal price when discounted).
// Prefers the normalized unit_price, falls back to the raw request price.
function linePrice(line) {
  const p = Number(line.unit_price ?? line.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

function lineOriginal(line) {
  const p = Number(line.original_price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// Render the line items of one order: name x qty, with the price actually
// charged and — when the item was a flash-sale deal — the struck-through
// original price + savings so the admin sees the discount applied at a glance.
function renderLineItems(lines) {
  if (!lines || lines.length === 0) return '—';
  return lines.map((line) => {
    if (typeof line === 'string') return line;
    const name = line.name || 'Item';
    const qty = Number(line.qty) > 1 ? ` x${line.qty}` : '';
    const price = linePrice(line);
    const original = lineOriginal(line);
    const isDeal = price !== null && original !== null && original > price;
    const savings = isDeal ? ((original - price) / original) * 100 : 0;
    return (
      <Box key={`${name}-${qty}-${price}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" component="span">
          {name}{qty}
        </Typography>
        {isDeal ? (
          <>
            <Typography variant="body2" component="span" sx={{ color: '#e23744', fontWeight: 700 }}>
              P{price}
            </Typography>
            <Typography variant="caption" component="span" sx={{ color: '#9aa0a6', textDecoration: 'line-through' }}>
              P{original}
            </Typography>
            <Chip label={`-${Math.round(savings)}%`} size="small" sx={{ height: 18, backgroundColor: '#ffe3dd', color: '#e23744', fontWeight: 800, fontSize: '0.65rem' }} />
          </>
        ) : price !== null ? (
          <Typography variant="body2" component="span" sx={{ color: colors.brandPrimaryDark, fontWeight: 600 }}>
            P{price}
          </Typography>
        ) : null}
      </Box>
    );
  });
}

// Plain-text lines for the search filter (works for both line shapes).
function linesToText(lines) {
  return lines.map((line) => {
    if (typeof line === 'string') return line;
    return `${line.name || ''} x${line.qty || 1}`;
  }).join(' ');
}

// Parse an order's status_history JSON into the [{ status, at }] timeline.
// Returns [] when the order predates status tracking.
function parseHistory(order) {
  try {
    const parsed = JSON.parse(order.status_history || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parsePaymentRecords(order) {
  try {
    const parsed = JSON.parse(order.payment_records || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStoredOrderArray(value) {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function parseStoredOrderObject(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return null; }
}

// Steps of the order lifecycle, in the order the admin acts on them.
const LEGACY_TIMELINE_STEPS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'fulfilled', label: 'Fulfilled' },
  { key: 'delivered', label: 'Delivered' },
];

// Shopee-style progress timeline: a dot per lifecycle step, filled when the
// order has reached it, with the timestamp of the transition underneath.
// A rejected order renders its own single red step instead of the ladder.
function StatusTimeline({ history, currentStatus, steps }) {
  if (currentStatus === 'rejected') {
    const rejectedAt = (history[history.length - 1] || {}).at;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: '#e23744', fontWeight: 700 }}>
          Rejected{rejectedAt ? ` · ${new Date(rejectedAt).toLocaleString()}` : ''}
        </Typography>
      </Box>
    );
  }
  // A cancellation ends the ladder as well — the steps to the left are what
  // actually happened, and the last one is the stop. Neutral ink, because the
  // customer choosing to cancel is not a failure the business has to fix.
  if (currentStatus === 'cancelled') {
    const cancelledAt = (history[history.length - 1] || {}).at;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
          Cancelled{cancelledAt ? ` · ${new Date(cancelledAt).toLocaleString()}` : ''}
        </Typography>
      </Box>
    );
  }
  const reached = new Set((history || []).map((h) => h.status));
  const at = (key) => ((history || []).find((h) => h.status === key) || {}).at;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0, mt: 1 }}>
      {steps.map((step, idx) => {
        const done = reached.has(step.key) || (currentStatus && steps.findIndex((s) => s.key === currentStatus) >= idx && currentStatus !== 'pending') || currentStatus === step.key;
        return (
          <Box key={step.key} sx={{ display: 'flex', alignItems: 'flex-start', flex: 1, flexDirection: idx === steps.length - 1 ? 'column' : 'row' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 64 }}>
              <Box sx={{
                width: 14, height: 14, borderRadius: '50%', mt: 0.5,
                backgroundColor: done ? colors.brandPrimary : '#e0e0e0',
                border: done ? 'none' : '2px solid #bdbdbd',
              }} />
              {idx < steps.length - 1 && (
                <Box sx={{ width: '100%', height: 2, backgroundColor: done ? colors.brandPrimary : '#e0e0e0', mt: '-0.5rem', mb: 0.25 }} />
              )}
              <Typography variant="caption" sx={{ fontWeight: done ? 700 : 400, color: done ? colors.textPrimary : '#9aa0a6', whiteSpace: 'nowrap' }}>
                {step.label}
              </Typography>
              {done && at(step.key) && (
                <Typography variant="caption" sx={{ color: '#9aa0a6', fontSize: '0.6rem', whiteSpace: 'nowrap' }}>
                  {new Date(at(step.key)).toLocaleDateString()}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default function OrderInquiriesPage({ onLogout }) {
  usePageTitle('/order-inquiries');
  const [orders, setOrders] = useState([]);
  const [companyDemo, setCompanyDemo] = useState(false);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  // `reason` is the rejection reason. It is REQUIRED for a rejection (the
  // backend refuses a bare one) and ignored for every other action.
  const [confirmDialog, setConfirmDialog] = useState({ open: false, id: null, status: '', reason: '', location_id: '', delivery_fee: '', delivery_schedule: '', order: null });
  const [receipt, setReceipt] = useState(null);
  const [cashReceiptTarget, setCashReceiptTarget] = useState(null);
  const [cashAmount, setCashAmount] = useState('');
  const [details, setDetails] = useState(null);
  const [refundAmounts, setRefundAmounts] = useState({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const timelineSteps = companyDemo
    ? [
      { key: 'pending', label: 'Review' },
      { key: 'approved', label: 'Confirmed' },
      { key: 'preparing', label: 'Preparing' },
      { key: 'fulfilled', label: 'Ready / dispatched' },
      { key: 'delivered', label: 'Delivered' },
    ]
    : LEGACY_TIMELINE_STEPS;
  const ordersRequestInFlight = useRef(false);

  const loadOrders = useCallback((silent = false) => {
    if (ordersRequestInFlight.current) return;
    ordersRequestInFlight.current = true;
    if (!silent) setLoading(true);
    apiGet('/api/order-inquiries')
      .then(r => setOrders(r.data || r))
      .catch(() => {})
      .finally(() => {
        ordersRequestInFlight.current = false;
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadOrders();
    apiGet('/api/order-inquiries/policy').then((policy) => setCompanyDemo(policy.demo_company_rules === true)).catch(() => setCompanyDemo(false));
    apiGet('/api/locations').then((r) => setLocations(Array.isArray(r) ? r : r.data || [])).catch(() => setLocations([]));
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') loadOrders(true);
    };
    const timer = window.setInterval(refreshIfVisible, 10000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadOrders]);

  const handleConfirmAction = (orderId, status) => {
    setConfirmDialog({ open: true, id: orderId, status, reason: '', location_id: '', delivery_fee: '', delivery_schedule: '', order: orders.find((order) => Number(order.id) === Number(orderId)) || null });
  };

  const closeConfirm = () => setConfirmDialog({ open: false, id: null, status: '', reason: '', location_id: '', delivery_fee: '', delivery_schedule: '', order: null });

  // A rejection is only meaningful with a reason the customer can act on, so
  // the Confirm button stays disabled until one is typed. The backend enforces
  // the same rule — this is the affordance, not the guard.
  const isRejection = confirmDialog.status === 'rejected';
  const reasonMissing = isRejection && !confirmDialog.reason.trim();
  const needsQuote = companyDemo && confirmDialog.status === 'approved' && confirmDialog.order?.fulfillment_method === 'courier';
  const needsStockLocation = !companyDemo && ['fulfilled', 'delivered'].includes(confirmDialog.status);
  const locationMissing = needsStockLocation && !Number(confirmDialog.location_id);
  const quoteMissing = needsQuote && (confirmDialog.delivery_fee === '' || !Number.isFinite(Number(confirmDialog.delivery_fee)) || Number(confirmDialog.delivery_fee) < 0 || !confirmDialog.delivery_schedule.trim());

  const executeAction = async() => {
    if (reasonMissing) return;
    try {
      await apiPut(`/api/order-inquiries/${confirmDialog.id}`, {
        status: confirmDialog.status,
        ...(isRejection ? { rejection_reason: confirmDialog.reason.trim() } : {}),
        ...(needsStockLocation ? { location_id: Number(confirmDialog.location_id) } : {}),
        ...(needsQuote ? { delivery_fee: Number(confirmDialog.delivery_fee), delivery_schedule: confirmDialog.delivery_schedule.trim() } : {}),
      });
      setSnackbar({ open: true, message: confirmDialog.status === 'approved' ? 'Order confirmed and stock reserved' : `Order marked ${confirmDialog.status}`, severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      closeConfirm();
    }
  };

  // Pending count drives an urgency chip in the header: work waiting in the
  // queue, at a glance.
  const pendingCount = (Array.isArray(orders) ? orders : []).filter(o => o.status === 'pending').length;

  const verifyPayment = async(orderId, paymentRecordId, amount) => {
    try {
      const result = await apiPut(`/api/order-inquiries/${orderId}/payment`, { payment_status: 'paid', ...(paymentRecordId ? { payment_record_id: paymentRecordId } : {}), ...(amount !== undefined ? { amount: Number(amount) } : {}) });
      setSnackbar({ open: true, message: result.payment_status === 'partial' ? `Partial payment verified · P${result.amount_paid} paid` : 'Payment verified', severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const authorizePartialPayment = async(orderId) => {
    try {
      await apiPut(`/api/order-inquiries/${orderId}/payment`, { allow_partial: true });
      setSnackbar({ open: true, message: 'Deposit or split payment authorized', severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const approveCredit = async(orderId) => {
    try {
      await apiPut(`/api/order-inquiries/${orderId}/payment`, { payment_status: 'credit_approved' });
      setSnackbar({ open: true, message: 'Existing customer credit arrangement approved', severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const saveCashReceived = async() => {
    if (!cashReceiptTarget) return;
    try {
      const result = await apiPut(`/api/order-inquiries/${cashReceiptTarget.id}/payment`, { payment_status: 'paid', amount: Number(cashAmount) });
      setSnackbar({ open: true, message: result.payment_status === 'partial' ? `Partial cash recorded · P${result.amount_paid} paid` : 'Cash payment recorded', severity: 'success' });
      setCashReceiptTarget(null);
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const openReceipt = async(orderId, recordId) => {
    try {
      const result = await apiGet(`/api/order-inquiries/${orderId}/payment-proof${recordId ? `?record_id=${encodeURIComponent(recordId)}` : ''}`);
      setReceipt(result.proof_data);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Could not load receipt image', severity: 'error' });
    }
  };

  const openReturnProof = async(orderId, requestId) => {
    try {
      const result = await apiGet(`/api/order-inquiries/${orderId}/return-proof?request_id=${encodeURIComponent(requestId)}`);
      setReceipt(result.proof_data);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Could not load the return photo', severity: 'error' });
    }
  };

  const reviewChangeRequest = async(order, decision) => {
    try {
      const result = await apiPut(`/api/order-inquiries/${order.id}/change-request`, { decision });
      setDetails((current) => current && Number(current.id) === Number(order.id) ? { ...current, change_request: JSON.stringify(result.change_request) } : current);
      setSnackbar({ open: true, message: `Change request ${decision}`, severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Could not review the change request', severity: 'error' });
    }
  };

  const reviewReturnRequest = async(order, request, decision) => {
    try {
      const refund = Number(refundAmounts[request.id] ?? order.amount_paid ?? 0);
      const result = await apiPut(`/api/order-inquiries/${order.id}/return-requests/${encodeURIComponent(request.id)}`, {
        decision,
        ...(decision === 'approved' ? { refund_amount: refund, refund_method: 'bank_transfer' } : {}),
      });
      setDetails((current) => current && Number(current.id) === Number(order.id) ? { ...current, return_requests: JSON.stringify(parseStoredOrderArray(current.return_requests).map((item) => item.id === request.id ? result.return_request : item)) } : current);
      setSnackbar({ open: true, message: decision === 'approved' ? `Demo refund recorded · P${refund.toFixed(2)}` : 'Return request declined', severity: 'success' });
      loadOrders();
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Could not review the return request', severity: 'error' });
    }
  };

  // Status dropdown filter (combined with the search bar): 'All statuses'
  // shows everything; a specific status narrows first, then the text search
  // runs on the remaining rows.
  const orderList = (Array.isArray(orders) ? orders : []).filter(order => {
    if (statusFilter && order.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const productsText = linesToText(parseLines(order)).toLowerCase();
    return (order.customer_name || '').toLowerCase().includes(q) ||
      (order.customer_email || '').toLowerCase().includes(q) ||
      (order.status || '').toLowerCase().includes(q) ||
      (order.payment_method || '').toLowerCase().includes(q) ||
      productsText.toLowerCase().includes(q);
  });

  const renderActions = (order) => {
    if (order.status === 'pending') {
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" onClick={() => setDetails(order)}>Details</Button>
          <Button size="small" variant="contained" color="secondary" startIcon={<span>✓</span>} onClick={() => handleConfirmAction(order.id, 'approved')}>{companyDemo ? 'Confirm & reserve' : 'Approve'}</Button>
          <Button size="small" variant="contained" color="error" startIcon={<span>✕</span>} onClick={() => handleConfirmAction(order.id, 'rejected')}>Reject</Button>
        </Box>
      );
    }
    if (companyDemo && order.status === 'approved') {
      return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Button size="small" onClick={() => setDetails(order)}>Details</Button><Button size="small" variant="contained" color="primary" onClick={() => handleConfirmAction(order.id, 'preparing')}>Start preparing</Button></Box>;
    }
    if (companyDemo && order.status === 'preparing') {
      const label = order.fulfillment_method === 'courier' ? 'Dispatch order' : 'Ready for pickup';
      return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Button size="small" onClick={() => setDetails(order)}>Details</Button><Button size="small" variant="contained" color="success" onClick={() => handleConfirmAction(order.id, 'fulfilled')}>{label}</Button></Box>;
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
      return <Box><Chip label="✓ Delivered" color="success" size="small" variant="outlined" /><Button size="small" onClick={() => setDetails(order)}>Details / return review</Button></Box>;
    }
    if (order.status === 'cancelled') {
      return <Chip label="Cancelled by customer" size="small" variant="outlined" />;
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
              Review incoming requests. Confirming reserves stock; staff verify payment before courier dispatch.
            </Typography>
          </div>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160, backgroundColor: colors.surface }}>
              <InputLabel id="inq-status-label">Status</InputLabel>
              <Select labelId="inq-status-label" id="inq-status" value={statusFilter} label="Status" onChange={e => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map(f => <MenuItem key={f.key || 'all'} value={f.key}>{f.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Search customer / email / status…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 260, backgroundColor: colors.surface }}
            />
            {pendingCount > 0 && (
              <Chip
                label={`${pendingCount} pending`}
                color="warning"
                size="small"
                sx={{ fontWeight: 700 }}
              />
            )}
            <Typography variant="subtitle2" color="text.secondary">{orderList.length} inquiries</Typography>
          </Box>
        </Box>
        <TableContainer sx={{ overflowX: 'auto' }}>
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
                <TableRow><TableCell colSpan={8}>Loading…</TableCell></TableRow>
              ) : orderList.length === 0 ? (
                <TableRow><TableCell colSpan={8}>No order inquiries</TableCell></TableRow>
              ) : orderList.map(order => {
                const lines = parseLines(order);
                return (
                  <TableRow key={order.id} sx={{ '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' } }}>
                    <TableCell>{order.customer_name}</TableCell>
                    <TableCell>{order.customer_email}</TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      {renderLineItems(lines)}
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontWeight: 700 }}>P{order.estimated_cost}</Typography>
                      {lines.some((l) => {
                        if (typeof l === 'string') return false;
                        const orig = lineOriginal(l);
                        const price = linePrice(l);
                        return orig !== null && price !== null && orig > price;
                      }) && (
                        <Chip label="includes flash deals" size="small" sx={{ mt: 0.5, height: 18, backgroundColor: '#ffe3dd', color: '#e23744', fontWeight: 700, fontSize: '0.65rem' }} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        {/* Fulfilment first: it decides whether the address below matters. */}
                        <Chip
                          size="small"
                          variant="outlined"
                          label={FULFILLMENT_LABELS[order.fulfillment_method] || FULFILLMENT_LABELS.pickup}
                          color={order.fulfillment_method === 'courier' ? 'info' : 'default'}
                        />
                        <Chip size="small" label={(order.payment_method || 'cod').toUpperCase()} color={order.payment_method === 'gcash' ? 'info' : 'default'} />
                        {order.payment_status === 'paid' && <Chip size="small" label="PAID" color="success" />}
                        {order.payment_status === 'pending_verification' && <Chip size="small" label="VERIFY PAYMENT" color="warning" />}
                        {order.payment_status === 'partial' && <Chip size="small" label="PARTIAL" color="warning" />}
                        {companyDemo && order.payment_status === 'credit_pending' && <Chip size="small" label="CREDIT REVIEW" color="warning" />}
                        {companyDemo && order.payment_status === 'credit_approved' && <Chip size="small" label="CREDIT APPROVED" color="success" />}
                        {order.payment_status === 'unpaid' && order.payment_method !== 'cod' && order.payment_method !== 'cash' && <Chip size="small" label="UNPAID" variant="outlined" />}
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        {order.delivery_address || '—'}
                        {order.payment_reference ? ` · Order ref ${order.payment_reference}` : ''}
                        {order.payment_customer_reference ? ` · Receipt ref ${order.payment_customer_reference}` : ''}
                      </Typography>
                      {companyDemo ? <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>P{Number(order.amount_paid || 0).toFixed(2)} paid · P{Math.max(0, Number(order.estimated_cost || 0) + Number(order.delivery_fee || 0) - Number(order.amount_paid || 0)).toFixed(2)} due</Typography> : null}
                      {order.payment_status === 'pending_verification' && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {companyDemo && parsePaymentRecords(order).filter((record) => record.status === 'pending_verification').map((record) => (
                            <Button key={record.id} size="small" variant="outlined" onClick={() => openReceipt(order.id, record.id)}>View receipt · P{record.amount}</Button>
                          ))}
                          <Button size="small" color="success" onClick={() => verifyPayment(order.id, companyDemo ? parsePaymentRecords(order).find((record) => record.status === 'pending_verification')?.id : undefined)}>Verify payment</Button>
                        </Box>
                      )}
                      {companyDemo && order.payment_method === 'cash' && order.payment_status !== 'paid' ? (
                        <Button size="small" color="success" onClick={() => { setCashReceiptTarget(order); setCashAmount(String(Math.max(0, Number(order.estimated_cost || 0) + Number(order.delivery_fee || 0) - Number(order.amount_paid || 0)))); }} sx={{ mt: 0.5 }}>Record cash received</Button>
                      ) : null}
                      {companyDemo && ['approved', 'preparing'].includes(order.status) && order.payment_status === 'credit_pending' ? (
                        <Button size="small" color="success" onClick={() => approveCredit(order.id)} sx={{ mt: 0.5 }}>Approve existing credit</Button>
                      ) : null}
                      {companyDemo && ['approved', 'preparing'].includes(order.status) && !parsePaymentRecords(order).some((record) => record.type === 'partial_payment_approval' && record.status === 'approved') && order.payment_status !== 'credit_pending' ? (
                        <Button size="small" onClick={() => authorizePartialPayment(order.id)} sx={{ mt: 0.5 }}>Authorize deposit / split</Button>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip label={companyDemo
                        ? ({ pending: 'Pending review', approved: 'Confirmed', preparing: 'Preparing', fulfilled: order.fulfillment_method === 'courier' ? 'Out for delivery' : 'Ready for pickup', delivered: 'Delivered', rejected: 'Rejected', cancelled: 'Cancelled' }[order.status] || order.status)
                        : order.status} color={STATUS_COLORS[order.status] || 'default'} size="small" />
                      {/* A rejected order carries the reason the admin gave —
                          never just the red chip. Same for a cancellation. */}
                      {order.status === 'rejected' && order.rejection_reason && (
                        <Typography variant="caption" display="block" sx={{ mt: 0.5, maxWidth: 220, color: 'error.main' }}>
                          {order.rejection_reason}
                        </Typography>
                      )}
                      {order.status === 'cancelled' && (
                        <Typography variant="caption" display="block" sx={{ mt: 0.5, maxWidth: 220, color: 'text.secondary' }}>
                          {order.cancellation_reason || 'No reason given'}
                        </Typography>
                      )}
                      {/* Compact progress dots so the timeline is visible at a
                          glance without opening Details (see StatusTimeline). */}
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                        {timelineSteps.map((step, idx) => {
                          const currentIdx = timelineSteps.findIndex((s) => s.key === order.status);
                          const reached = order.status === 'rejected' ? false : currentIdx >= idx;
                          return <Box key={step.key} sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: reached ? colors.brandPrimary : '#e0e0e0' }} />;
                        })}
                      </Box>
                    </TableCell>
                    <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>{renderActions(order)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={confirmDialog.open} onClose={closeConfirm} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm action: mark this inquiry as “{confirmDialog.status}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: isRejection ? 2 : 0 }}>
            The status is saved to the customer&apos;s order history. Email is sent only when an email provider is configured.
          </Typography>
          {isRejection && (
            <TextField
              fullWidth
              required
              multiline
              minRows={2}
              label="Why is this inquiry being rejected?"
              helperText="Required — the customer sees this. e.g. &quot;Out of stock until next week&quot;."
              value={confirmDialog.reason}
              onChange={(e) => setConfirmDialog((d) => ({ ...d, reason: e.target.value }))}
              inputProps={{ maxLength: 500 }}
              error={confirmDialog.reason.length > 500}
              autoFocus
            />
          )}
          {needsQuote && (
            <Box sx={{ display: 'grid', gap: 1.5, mt: 2 }}>
              <Typography variant="body2">Set the delivery fee and schedule now so the customer can review them before paying.</Typography>
              <TextField
                fullWidth required type="number" label="Delivery fee (PHP)"
                value={confirmDialog.delivery_fee}
                onChange={(e) => setConfirmDialog((d) => ({ ...d, delivery_fee: e.target.value }))}
                inputProps={{ min: 0, step: '0.01' }}
              />
              <TextField
                fullWidth required label="Confirmed delivery schedule"
                placeholder="e.g. Saturday, 10:00 AM–12:00 PM"
                value={confirmDialog.delivery_schedule}
                onChange={(e) => setConfirmDialog((d) => ({ ...d, delivery_schedule: e.target.value }))}
                inputProps={{ maxLength: 200 }}
              />
            </Box>
          )}
          {needsStockLocation && (
            <FormControl fullWidth required size="small" sx={{ mt: 2 }}>
              <InputLabel id="fulfillment-location-label">Stock location</InputLabel>
              <Select
                labelId="fulfillment-location-label"
                value={confirmDialog.location_id}
                label="Stock location"
                onChange={(e) => setConfirmDialog((d) => ({ ...d, location_id: e.target.value }))}
              >
                {locations.map((location) => (
                  <MenuItem key={location.id} value={location.id}>{location.name}</MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                Stock and the sales ledger update together when fulfillment is confirmed.
              </Typography>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirm}>Cancel</Button>
          <Button onClick={executeAction} variant="contained" color="primary" disabled={reasonMissing || locationMissing || quoteMissing}>
            Confirm
          </Button>
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
              <Box mb={1}>
                {renderLineItems(parseLines(details))}
              </Box>
              <Typography variant="subtitle2">Cost</Typography>
              <Typography variant="body2" mb={1}>P{details.estimated_cost} items{details.bulk_discount_amount ? ` · −P${details.bulk_discount_amount} bulk discount` : ''}{companyDemo && details.fulfillment_method === 'courier' ? ` · P${details.delivery_fee || 0} delivery` : ''} · {details.payment_method?.toUpperCase()} · {details.payment_status || 'unpaid'}</Typography>
              {companyDemo && details.delivery_schedule ? <Typography variant="body2" mb={1}>Delivery schedule: {details.delivery_schedule}</Typography> : null}
              {companyDemo ? <Typography variant="body2" mb={1}>Paid P{Number(details.amount_paid || 0).toFixed(2)} · Due P{Math.max(0, Number(details.estimated_cost || 0) + Number(details.delivery_fee || 0) - Number(details.amount_paid || 0)).toFixed(2)}</Typography> : null}
              <Typography variant="subtitle2">Fulfilment</Typography>
              <Typography variant="body2" mb={1}>
                {FULFILLMENT_LABELS[details.fulfillment_method] || FULFILLMENT_LABELS.pickup}
                {details.fulfillment_method === 'courier' ? ` · ${details.delivery_address || 'no address'}` : ' · customer collects'}
              </Typography>
              <Typography variant="subtitle2">Delivery address</Typography>
              <Typography variant="body2" mb={1}>{details.delivery_address || '—'}</Typography>
              {details.status === 'rejected' && (
                <>
                  <Typography variant="subtitle2">Rejection reason</Typography>
                  <Typography variant="body2" mb={1} color="error.main">{details.rejection_reason || '—'}</Typography>
                </>
              )}
              {details.status === 'cancelled' && (
                <>
                  <Typography variant="subtitle2">Cancelled by the customer</Typography>
                  <Typography variant="body2" mb={1}>
                    {details.cancelled_at ? new Date(details.cancelled_at).toLocaleString() : '—'}
                    {details.cancellation_reason ? ` · ${details.cancellation_reason}` : ''}
                  </Typography>
                </>
              )}
              {details.payment_reference && (
                <>
                  <Typography variant="subtitle2">Order payment reference</Typography>
                  <Typography variant="body2" mb={1}>{details.payment_reference}</Typography>
                </>
              )}
              {details.payment_customer_reference && (
                <>
                  <Typography variant="subtitle2">Customer GCash receipt reference</Typography>
                  <Typography variant="body2" mb={1}>{details.payment_customer_reference}</Typography>
                </>
              )}
              <Typography variant="subtitle2">Status timeline</Typography>
              <Box mb={1.5}>
                <StatusTimeline history={parseHistory(details)} currentStatus={details.status} steps={timelineSteps} />
              </Box>
              <Typography variant="subtitle2">Notes</Typography>
              <Typography variant="body2">{details.notes || '—'}</Typography>
              {companyDemo && parseStoredOrderObject(details.change_request) ? (
                <Box sx={{ mt: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="subtitle2">Customer change request · {parseStoredOrderObject(details.change_request).status}</Typography>
                  <Typography variant="body2" sx={{ my: 1 }}>{parseStoredOrderObject(details.change_request).message}</Typography>
                  {parseStoredOrderObject(details.change_request).response ? <Typography variant="caption" display="block">Response: {parseStoredOrderObject(details.change_request).response}</Typography> : null}
                  {parseStoredOrderObject(details.change_request).status === 'pending' ? (
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                      <Button size="small" color="success" variant="contained" onClick={() => reviewChangeRequest(details, 'accepted')}>Acknowledge request</Button>
                      <Button size="small" color="error" onClick={() => reviewChangeRequest(details, 'declined')}>Decline</Button>
                    </Box>
                  ) : null}
                </Box>
              ) : null}
              {companyDemo && parseStoredOrderArray(details.return_requests).map((request) => (
                <Box key={request.id} sx={{ mt: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="subtitle2">Return report · {request.reason} · {request.status}</Typography>
                  {request.message ? <Typography variant="body2" sx={{ my: 0.5 }}>{request.message}</Typography> : null}
                  <Typography variant="caption" display="block">Reported {request.requested_at ? new Date(request.requested_at).toLocaleString() : '—'}</Typography>
                  {request.proof_data || request.status === 'pending' ? <Button size="small" onClick={() => openReturnProof(details.id, request.id)}>View photo evidence</Button> : null}
                  {request.status === 'pending' ? (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 1 }}>
                      <TextField size="small" type="number" label="Refund amount (PHP)" inputProps={{ min: 0, max: details.amount_paid || 0, step: '0.01' }} value={refundAmounts[request.id] ?? Number(details.amount_paid || 0)} onChange={(event) => setRefundAmounts((previous) => ({ ...previous, [request.id]: event.target.value }))} />
                      <Button size="small" color="success" variant="contained" onClick={() => reviewReturnRequest(details, request, 'approved')}>Approve · record demo refund</Button>
                      <Button size="small" color="error" onClick={() => reviewReturnRequest(details, request, 'declined')}>Decline</Button>
                    </Box>
                  ) : request.refund_status ? <Typography variant="caption" display="block">Refund P{Number(request.refund_amount || 0).toFixed(2)} · {request.refund_method} · demo record only</Typography> : null}
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetails(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(receipt)} onClose={() => setReceipt(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Customer payment receipt</DialogTitle>
        <DialogContent dividers>
          {receipt ? <Box component="img" src={receipt} alt="Customer payment proof" sx={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', mx: 'auto' }} /> : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setReceipt(null)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(cashReceiptTarget)} onClose={() => setCashReceiptTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Record cash received</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>Cash is collected at pickup. A partial amount is allowed only after staff authorizes a deposit or split payment.</Typography>
          <TextField autoFocus fullWidth type="number" label="Amount received (PHP)" inputProps={{ min: 0.01, max: cashReceiptTarget ? Number(cashReceiptTarget.estimated_cost || 0) + Number(cashReceiptTarget.delivery_fee || 0) - Number(cashReceiptTarget.amount_paid || 0) : undefined, step: '0.01' }} value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCashReceiptTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveCashReceived} disabled={!Number.isFinite(Number(cashAmount)) || Number(cashAmount) <= 0}>Record payment</Button>
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

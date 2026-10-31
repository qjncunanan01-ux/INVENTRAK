import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { apiGet, apiPut } from '../../api';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

function parseRecords(order) {
  try {
    const parsed = JSON.parse(order.payment_records || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function paymentTotal(order) {
  return Number(order.estimated_cost || 0) + Number(order.delivery_fee || 0);
}

function paymentChipColor(status) {
  if (['paid', 'credit_approved'].includes(status)) return 'success';
  if (['pending_verification', 'partial', 'credit_pending'].includes(status)) return 'warning';
  if (['failed', 'refunded'].includes(status)) return 'error';
  return 'default';
}

export default function PaymentsPage({ onLogout }) {
  usePageTitle('/payments');
  const [orders, setOrders] = useState([]);
  const [companyDemo, setCompanyDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [receipt, setReceipt] = useState(null);
  const [cashTarget, setCashTarget] = useState(null);
  const [cashAmount, setCashAmount] = useState('');
  const inFlight = useRef(false);

  const loadPayments = useCallback((silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    apiGet('/api/order-inquiries')
      .then((result) => {
        setOrders(Array.isArray(result) ? result : result.data || []);
        setLoadError('');
      })
      .catch((error) => {
        setLoadError(error.message || 'Could not load payment records.');
      })
      .finally(() => {
        inFlight.current = false;
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadPayments();
    apiGet('/api/order-inquiries/policy')
      .then((policy) => setCompanyDemo(policy.demo_company_rules === true))
      .catch(() => setCompanyDemo(false));
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') loadPayments(true);
    };
    const timer = window.setInterval(refreshIfVisible, 10000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('focus', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('focus', refreshIfVisible);
    };
  }, [loadPayments]);

  const paymentOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      const records = parseRecords(order);
      const hasPaymentData = order.payment_method || order.payment_status || records.length > 0 || Number(order.amount_paid) > 0;
      if (!hasPaymentData) return false;
      if (statusFilter && String(order.payment_status || 'unpaid') !== statusFilter) return false;
      if (!query) return true;
      return [order.id, order.customer_name, order.customer_email, order.payment_method,
        order.payment_status, order.payment_reference, order.payment_customer_reference]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [orders, search, statusFilter]);

  const verifyPayment = async(order, paymentRecordId) => {
    try {
      const result = await apiPut(`/api/order-inquiries/${order.id}/payment`, {
        payment_status: 'paid',
        ...(paymentRecordId ? { payment_record_id: paymentRecordId } : {}),
      });
      setSnackbar({
        open: true,
        message: result.payment_status === 'partial' ? `Partial payment verified · P${result.amount_paid} paid` : 'Payment verified',
        severity: 'success',
      });
      loadPayments(true);
    } catch (error) {
      setSnackbar({ open: true, message: error.message || 'Could not update the payment', severity: 'error' });
    }
  };

  const openReceipt = async(order, recordId) => {
    try {
      const result = await apiGet(`/api/order-inquiries/${order.id}/payment-proof${recordId ? `?record_id=${encodeURIComponent(recordId)}` : ''}`);
      setReceipt({ title: `Payment proof · Order #${order.id}`, image: result.proof_data });
    } catch (error) {
      setSnackbar({ open: true, message: error.message || 'Could not load the receipt image', severity: 'error' });
    }
  };

  const recordCashReceived = async() => {
    if (!cashTarget) return;
    try {
      const result = await apiPut(`/api/order-inquiries/${cashTarget.id}/payment`, {
        payment_status: 'paid',
        amount: Number(cashAmount),
      });
      setSnackbar({ open: true, message: result.payment_status === 'partial' ? `Partial cash recorded · P${result.amount_paid} paid` : 'Cash payment recorded', severity: 'success' });
      setCashTarget(null);
      loadPayments(true);
    } catch (error) {
      setSnackbar({ open: true, message: error.message || 'Could not record cash', severity: 'error' });
    }
  };

  const authorizePartialPayment = async(order) => {
    try {
      await apiPut(`/api/order-inquiries/${order.id}/payment`, { allow_partial: true });
      setSnackbar({ open: true, message: 'Deposit or split payment authorized', severity: 'success' });
      loadPayments(true);
    } catch (error) {
      setSnackbar({ open: true, message: error.message || 'Could not authorize partial payment', severity: 'error' });
    }
  };

  const approveCredit = async(order) => {
    try {
      await apiPut(`/api/order-inquiries/${order.id}/payment`, { payment_status: 'credit_approved' });
      setSnackbar({ open: true, message: 'Existing customer credit arrangement approved', severity: 'success' });
      loadPayments(true);
    } catch (error) {
      setSnackbar({ open: true, message: error.message || 'Could not approve credit', severity: 'error' });
    }
  };

  return (
    <AdminLayout onLogout={onLogout}>
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>Payments</Typography>
            <Typography variant="body2" color="text.secondary">Review receipts and track amounts paid or due for customer orders.</Typography>
          </Box>
          <Chip label={`${paymentOrders.length} records`} color="primary" variant="outlined" />
        </Box>

        {companyDemo && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Demo payments do not transfer money. GCash and bank-transfer receipts are reviewed manually here.
          </Alert>
        )}
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}

        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Search payments"
              placeholder="Order, customer, reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ minWidth: 260, flex: 1 }}
            />
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel id="payment-status-label">Payment status</InputLabel>
              <Select labelId="payment-status-label" value={statusFilter} label="Payment status" onChange={(event) => setStatusFilter(event.target.value)}>
                <MenuItem value="">All payments</MenuItem>
                <MenuItem value="pending_verification">Needs review</MenuItem>
                <MenuItem value="unpaid">Unpaid</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="paid">Paid</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
                {companyDemo && <MenuItem value="credit_pending">Credit review</MenuItem>}
                {companyDemo && <MenuItem value="credit_approved">Credit approved</MenuItem>}
              </Select>
            </FormControl>
          </Box>
        </Paper>

        <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Order / customer</TableCell>
                <TableCell>Method / reference</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Payment status</TableCell>
                <TableCell>Receipt / actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5}>Loading payment records…</TableCell></TableRow>
              ) : paymentOrders.length === 0 ? (
                <TableRow><TableCell colSpan={5}>No payment records match this filter.</TableCell></TableRow>
              ) : paymentOrders.map((order) => {
                const records = parseRecords(order);
                const pendingRecords = records.filter((record) => record.status === 'pending_verification');
                const gatewayManagedQrPh = order.payment_method === 'qrph' && order.payment_provider === 'paymongo';
                const missingQrPhCheckout = order.payment_method === 'qrph' && order.payment_provider !== 'paymongo';
                const total = paymentTotal(order);
                const paid = Number(order.amount_paid || 0);
                const due = Math.max(0, total - paid);
                return (
                  <TableRow key={order.id} hover>
                    <TableCell sx={{ minWidth: 180 }}>
                      <Typography sx={{ fontWeight: 700 }}>Order #{order.id}</Typography>
                      <Typography variant="body2">{order.customer_name || 'Customer'}</Typography>
                      <Typography variant="caption" color="text.secondary">{order.status || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 190 }}>
                      <Typography>{String(order.payment_method || '—').replace('_', ' ').toUpperCase()}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">Order ref: {order.payment_reference || '—'}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">Receipt ref: {order.payment_customer_reference || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 150 }}>
                      <Typography>Total P{total.toFixed(2)}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">Paid P{paid.toFixed(2)} · Due P{due.toFixed(2)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={paymentChipColor(order.payment_status)} label={String(order.payment_status || 'unpaid').replaceAll('_', ' ')} />
                    </TableCell>
                    <TableCell sx={{ minWidth: 245 }}>
                      {!gatewayManagedQrPh && pendingRecords.map((record) => (
                        <Box key={record.id} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
                          {record.proof_available !== false && (
                            <Button size="small" variant="outlined" onClick={() => openReceipt(order, record.id)}>View receipt · P{Number(record.amount || 0).toFixed(2)}</Button>
                          )}
                          <Button size="small" color="success" onClick={() => verifyPayment(order, record.id)}>Verify</Button>
                        </Box>
                      ))}
                      {!gatewayManagedQrPh && order.payment_status === 'pending_verification' && pendingRecords.length === 0 && (
                        <Button size="small" color="success" onClick={() => verifyPayment(order)}>Verify payment</Button>
                      )}
                      {gatewayManagedQrPh && order.payment_status !== 'paid' && (
                        <Typography variant="caption" color="text.secondary" display="block">Awaiting PayMongo QR Ph confirmation</Typography>
                      )}
                      {missingQrPhCheckout && (
                        <Typography variant="caption" color="warning.main" display="block">Checkout was not created. Contact the customer; do not mark this payment paid manually.</Typography>
                      )}
                      {companyDemo && order.payment_method === 'cash' && order.payment_status !== 'paid' && (
                        <Button size="small" color="success" onClick={() => {
                          setCashTarget(order);
                          setCashAmount(String(due));
                        }}>Record cash</Button>
                      )}
                      {companyDemo && ['approved', 'preparing'].includes(order.status) && order.payment_status === 'credit_pending' && (
                        <Button size="small" color="success" onClick={() => approveCredit(order)}>Approve credit</Button>
                      )}
                      {companyDemo && ['approved', 'preparing'].includes(order.status)
                        && order.payment_status !== 'credit_pending'
                        && !records.some((record) => record.type === 'partial_payment_approval' && record.status === 'approved') && (
                        <Button size="small" onClick={() => authorizePartialPayment(order)}>Allow deposit / split</Button>
                      )}
                      {!gatewayManagedQrPh && !missingQrPhCheckout && pendingRecords.length === 0 && order.payment_status !== 'pending_verification'
                        && !(companyDemo && order.payment_method === 'cash' && order.payment_status !== 'paid')
                        && !(companyDemo && ['approved', 'preparing'].includes(order.status) && order.payment_status === 'credit_pending')
                        && !(companyDemo && ['approved', 'preparing'].includes(order.status) && order.payment_status !== 'credit_pending' && !records.some((record) => record.type === 'partial_payment_approval' && record.status === 'approved'))
                        && <Typography variant="caption" color="text.secondary">No action needed</Typography>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Dialog open={Boolean(receipt)} onClose={() => setReceipt(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{receipt?.title || 'Payment proof'}</DialogTitle>
        <DialogContent dividers>
          {receipt?.image ? <Box component="img" src={receipt.image} alt="Customer payment proof" sx={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', mx: 'auto' }} /> : null}
        </DialogContent>
        <DialogActions><Button onClick={() => setReceipt(null)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(cashTarget)} onClose={() => setCashTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Record cash received · Order #{cashTarget?.id}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>Cash is collected at pickup. A partial amount needs staff approval first.</Typography>
          <TextField autoFocus fullWidth type="number" label="Amount received (PHP)" inputProps={{ min: 0.01, max: cashTarget ? paymentTotal(cashTarget) - Number(cashTarget.amount_paid || 0) : undefined, step: '0.01' }} value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCashTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={recordCashReceived} disabled={!Number.isFinite(Number(cashAmount)) || Number(cashAmount) <= 0}>Record payment</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((current) => ({ ...current, open: false }))}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

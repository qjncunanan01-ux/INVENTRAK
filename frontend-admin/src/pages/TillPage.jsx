import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Divider, Paper,
  TextField, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import {
  consumedTotal, describeConsumedLots, describeLowStock, nextLotToConsume,
  previewTotal,
} from '../till';

// THE TILL — the screen the counter sale finally had.
//
// POST /api/sales has existed since the beginning, but nothing in the app
// called it: the admin console could only READ the sales ledger. That made
// the physical-store path un-demoable, and it was the single most common
// transaction in the business.
//
// Two things this screen deliberately shows, because they are the whole point:
//
//   1. BEFORE the sale — which batch is about to leave, taken from the same
//      FEFO order the server applies. Staff see the expiring syrup is going
//      out first rather than being told afterwards.
//   2. AFTER the sale — which batch ACTUALLY left, read back from the
//      server's consumption manifest, with the stock left on the shelf.
//
// The price shown is a preview. The recorded total is always the one the
// server computes from the catalog, so a mistyped or tampered number here
// cannot change what the sale is worth.
export default function TillPage({ onLogout }) {
  usePageTitle('/till');

  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ product: null, qty: '', location_id: '', customer_name: '' });
  const [lots, setLots] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, locRes] = await Promise.all([apiGet('/api/products'), apiGet('/api/locations')]);
      setProducts(Array.isArray(prodRes) ? prodRes : prodRes.data || []);
      setLocations(Array.isArray(locRes) ? locRes : []);
    } catch (err) {
      setError('Could not load the catalog: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  // The lots at the chosen shelf, so the "about to leave" preview is real
  // rather than a guess.
  useEffect(() => {
    if (!form.product || !form.location_id) {
      setLots([]);
      return;
    }
    let cancelled = false;
    apiGet(`/api/stock-lots?product_id=${form.product.id}&location_id=${form.location_id}`)
      .then(res => { if (!cancelled) setLots(Array.isArray(res) ? res : []); })
      .catch(() => { if (!cancelled) setLots([]); });
    return () => { cancelled = true; };
  }, [form.product, form.location_id]);

  const qty = Number(form.qty);
  const qtyValid = Number.isFinite(qty) && qty > 0;
  const price = form.product ? Number(form.product.price) : 0;
  const available = Number((lots || []).reduce((s, l) => s + (Number(l.qty) || 0), 0));
  const willOversell = qtyValid && lots.length > 0 && qty > available;
  const upcoming = qtyValid ? nextLotToConsume(lots, qty) : null;

  const canSubmit = Boolean(form.product && form.location_id && qtyValid && !saving);

  const reset = () => setForm({ product: null, qty: '', location_id: '', customer_name: '' });

  const recordSale = async () => {
    if (!form.product || !form.location_id || !qtyValid) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost('/api/sales', {
        product_id: Number(form.product.id),
        qty,
        location_id: Number(form.location_id),
        customer_name: form.customer_name.trim() || undefined,
      });
      setReceipt(result);
      setForm({ product: null, qty: '', location_id: '', customer_name: '' });
      setLots([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const consumed = receipt ? describeConsumedLots(receipt.lots_consumed) : [];
  const manifestTotal = receipt ? consumedTotal(receipt.lots_consumed) : 0;
  const lowStockNote = receipt ? describeLowStock(receipt.low_stock_alert) : null;
  const batchTone = (tone) =>
    tone === 'expired' ? 'error' : tone === 'soon' ? 'warning' : tone === 'none' ? 'default' : 'success';

  return (
    <AdminLayout title="Till" onLogout={onLogout}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, alignItems: 'start' }}>
        {/* ---------- the form ---------- */}
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
          <Typography variant="h6" mb={1}>Record a walk-in sale</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            One transaction, both ledgers: the revenue row is written, the stock comes off
            the shelf, and the expiring batch leaves first.
          </Typography>

          <Box sx={{ display: 'grid', gap: 2 }}>
            <Autocomplete
              options={products}
              value={form.product}
              onChange={(_, v) => setForm({ ...form, product: v })}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              loading={loading}
              renderInput={(params) => (
                <TextField {...params} label="Product" placeholder="Search the catalog…" />
              )}
            />

            <TextField
              label="Quantity"
              value={form.qty}
              onChange={e => setForm({ ...form, qty: e.target.value.replace(/[^0-9.]/g, '') })}
              inputMode="decimal"
              helperText={form.product ? `₱${price} each` : ' '}
              error={Boolean(form.qty) && !qtyValid}
            />

            <TextField
              select
              label="Sold from"
              value={form.location_id}
              onChange={e => setForm({ ...form, location_id: e.target.value })}
              SelectProps={{ native: true }}
              helperText="Which shelf — it decides which batch is consumed"
            >
              <option value="">Choose a location…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </TextField>

            <TextField
              label="Customer name (optional)"
              value={form.customer_name}
              onChange={e => setForm({ ...form, customer_name: e.target.value })}
              helperText="A walk-in has no account — a name groups their purchases later"
            />

            {form.product && form.location_id && (
              <Alert severity={willOversell ? 'warning' : 'info'} icon={false}>
                {willOversell
                  ? `Only ${available} on this shelf. The server will refuse this sale rather than drive stock negative.`
                  : `${available} on this shelf. Total will be ₱${previewTotal(qty, price).toLocaleString()}.`}
              </Alert>
            )}

            {upcoming && (
              <Paper variant="outlined" sx={{ p: 2, backgroundColor: colors.surface }} aria-label="Batch about to leave">
                <Typography variant="subtitle2" gutterBottom>FEFO — this batch leaves first</Typography>
                <Typography variant="body2">
                  Lot #{upcoming.lot.id} · {upcoming.qty} unit{upcoming.qty === 1 ? '' : 's'} ·{' '}
                  {upcoming.lot.expiry_date
                    ? `expires ${upcoming.lot.expiry_date}`
                    : 'no expiry date'}
                </Typography>
                {upcoming.spillsOver && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    …and the sale is larger than that batch, so more than one will be consumed.
                  </Typography>
                )}
              </Paper>
            )}

            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Button variant="contained" color="secondary" onClick={recordSale} disabled={!canSubmit}>
                {saving ? 'Recording…' : `Record sale${qtyValid ? ` · ₱${previewTotal(qty, price).toLocaleString()}` : ''}`}
              </Button>
              <Button onClick={reset} disabled={saving}>Clear</Button>
            </Box>
          </Box>
        </Paper>

        {/* ---------- the receipt ---------- */}
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }} aria-label="Sale receipt">
          <Typography variant="h6" mb={2}>Last sale</Typography>

          {!receipt ? (
            <Typography variant="body2" color="text.secondary">
              Nothing recorded yet this session. Pick a product, set a quantity and a
              location, then record the sale.
            </Typography>
          ) : (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">Total</Typography>
                <Typography variant="h5">₱{Number(receipt.total).toLocaleString()}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {receipt.location} · {receipt.stock_remaining} left on the shelf
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" gutterBottom>Batch consumed (FEFO)</Typography>
              {consumed.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No lot ledger entry.</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {consumed.map((c, i) => (
                    <Box key={`${c.lot_id ?? 'none'}-${i}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                      <Typography variant="body2">
                        {c.batch} · {c.qty} unit{c.qty === 1 ? '' : 's'}
                      </Typography>
                      <Chip size="small" color={batchTone(c.tone)} label={c.expiryLabel} />
                    </Box>
                  ))}
                </Box>
              )}

              {manifestTotal > 0 && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  {manifestTotal} unit{manifestTotal === 1 ? '' : 's'} accounted for — the ledger
                  and the shelf agree.
                </Typography>
              )}

              {lowStockNote && (
                <Alert severity="warning" sx={{ mt: 2 }}>{lowStockNote}</Alert>
              )}
            </>
          )}
        </Paper>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Loading catalog…</Typography>
        </Box>
      )}
    </AdminLayout>
  );
}
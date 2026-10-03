import {
  Alert, Box, Button, Chip, Divider, Paper, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, getCurrentUser } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import FormulaBanner from '../components/FormulaBanner';
import { RECONCILIATION_FORMULA, caveats, describeRow, headline, peso, rowTone } from '../reconciliation';

// SHELF vs SYSTEM — the discrepancy report.
//
// What it answers: "the shelf and the ledger disagree — which products, and how
// much money?"
//
// What it deliberately does NOT do, because the data cannot support it:
//
//   - It does not know the opening stock. There is no opening-balance record
//     anywhere in this system, so "expected = stock − sales" would just echo
//     the seed back. The anchor is a real count, taken by a person.
//   - It does not name a cause. A unit missing from a shelf is identical in
//     the data whether it was stolen, broken, or rung up on paper. The report
//     says "unaccounted for" and stops there.
//   - It does not blame anyone. `counted_by` is on screen for the audit trail.
//
// The formula and its plain-language reading are printed above the table, so
// every number below has a rule next to it rather than a slogan.
export default function ReconciliationPage({ onLogout }) {
  usePageTitle('/reconciliation');

  const isStaff = getCurrentUser()?.role === 'staff';
  const [report, setReport] = useState(null);
  const [inventory, setInventory] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [onlyVariance, setOnlyVariance] = useState(true);
  const [form, setForm] = useState({ product_id: '', location_id: '', counted_qty: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const inv = await apiGet('/api/inventory');
      setInventory({ locations: inv.locations || [], items: inv.items || [] });
      // Staff may record a count but may not read money at risk, so they get
      // an empty report rather than a 403 they cannot act on.
      if (!isStaff) {
        const res = await apiGet(`/api/inventory/reconciliation${onlyVariance ? '?only_variance=true' : ''}`);
        setReport(res);
      } else {
        setReport(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isStaff, onlyVariance]);

  useEffect(() => { load(); }, [load]);

  // What the system believes right now, for the chosen shelf — shown next to
  // the counter's figure so the difference is visible as they type.
  const systemNow = (() => {
    if (!form.product_id || !form.location_id) return null;
    const item = inventory.items.find(i => Number(i.product?.id) === Number(form.product_id));
    if (!item) return null;
    const loc = inventory.locations.find(l => Number(l.id) === Number(form.location_id));
    if (!loc) return null;
    return Number(item.locations[loc.name] ?? 0);
  })();

  const recordCount = async () => {
    if (!form.product_id || !form.location_id || form.counted_qty === '') {
      setError('Pick a product, a shelf and the quantity you counted.');
      return;
    }
    const counted = Number(form.counted_qty);
    if (!Number.isFinite(counted) || counted < 0) {
      setError('The counted quantity must be zero or more.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiPost('/api/inventory/count', {
        product_id: Number(form.product_id),
        location_id: Number(form.location_id),
        counted_qty: counted,
        note: form.note.trim() || undefined,
      });
      const delta = res.variance;
      setNotice(
        `Counted ${res.counted_qty}; the system said ${res.system_qty}. ` +
        (delta === 0
          ? 'It matched.'
          : `Difference of ${Math.abs(delta)} unit${Math.abs(delta) === 1 ? '' : 's'} ${delta < 0 ? 'missing' : 'over'}.`)
      );
      setForm({ product_id: '', location_id: '', counted_qty: '', note: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const rows = (report && report.rows) || [];
  const summary = (report && report.summary) || null;
  const countedLocations = new Set(rows.map(r => r.location_id)).size;

  return (
    <AdminLayout title="Shelf vs System" onLogout={onLogout}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1.4fr' }, alignItems: 'start' }}>
        {/* ---------- record a count ---------- */}
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
          <Typography variant="h6" mb={1}>Count a shelf</Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Physical stock is only knowable by counting it. Walk the shelf, enter what is
            actually there — the system remembers what it believed at that moment so the
            difference can be worked out later.
          </Typography>

          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField
              select label="Product" value={form.product_id}
              onChange={e => setForm({ ...form, product_id: e.target.value })}
              SelectProps={{ native: true }}
            >
              <option value="">Choose a product…</option>
              {inventory.items.map(i => (
                <option key={i.product?.id} value={i.product?.id}>{i.product?.name}</option>
              ))}
            </TextField>

            <TextField
              select label="Shelf" value={form.location_id}
              onChange={e => setForm({ ...form, location_id: e.target.value })}
              SelectProps={{ native: true }}
            >
              <option value="">Choose a shelf…</option>
              {inventory.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </TextField>

            <TextField
              label="Counted quantity" value={form.counted_qty} inputMode="decimal"
              onChange={e => setForm({ ...form, counted_qty: e.target.value.replace(/[^0-9.]/g, '') })}
              helperText={systemNow === null ? ' ' : `The system currently says ${systemNow} on this shelf.`}
            />

            <TextField
              label="Note (optional)" value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
            />

            <Button
              variant="contained" color="secondary" onClick={recordCount}
              disabled={saving || !form.product_id || !form.location_id || form.counted_qty === ''}
            >
              {saving ? 'Recording…' : 'Record count'}
            </Button>
          </Box>
        </Paper>

        {/* ---------- the report ---------- */}
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }} aria-label="Reconciliation report">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 2 }}>
            <Typography variant="h6">Shelf vs system</Typography>
            {!isStaff && (
              <Button size="small" onClick={() => setOnlyVariance(!onlyVariance)}>
                {onlyVariance ? 'Show all counted shelves' : 'Show only differences'}
              </Button>
            )}
          </Box>

          {isStaff ? (
            <Alert severity="info">
              Counting is yours to record. The reconciliation report shows money at risk, so
              it is admin-tier — ask an admin to run it.
            </Alert>
          ) : (
            <>
              <FormulaBanner
                  dense
                  title="The math behind every number below"
                  items={[
                    RECONCILIATION_FORMULA,
                    'counted              what a person physically saw on the shelf',
                    'recorded sales       what the till says left since that count',
                    'unaccounted > 0      the system believes stock that is NOT there',
                    'unaccounted < 0      more found than expected (not a loss)',
                  ]}
                  note="Sales carry no location, so a count at one shelf is checked against every recorded sale of that product. The report does not say WHY a unit is missing — breakage, a till error and theft look identical in the data."
                />

              <Typography variant="body2" sx={{ mt: 2, mb: 2 }}>{headline(summary, countedLocations)}</Typography>

              {summary && summary.value_at_risk > 0 && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {peso(summary.value_at_risk)} of stock is on the books but not on the shelf,
                  across {summary.shrinkage_units} unit{summary.shrinkage_units === 1 ? '' : 's'}.
                </Alert>
              )}

              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell>Shelf</TableCell>
                    <TableCell align="right">Counted</TableCell>
                    <TableCell align="right">System</TableCell>
                    <TableCell align="right">Sales since</TableCell>
                    <TableCell align="right">Expected</TableCell>
                    <TableCell align="right">Unaccounted</TableCell>
                    <TableCell align="right">Value at risk</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={8}>Loading…</TableCell></TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8}>
                        Nothing to compare yet. Count a shelf and it appears here.
                      </TableCell>
                    </TableRow>
                  ) : rows.map(r => {
                    const tone = rowTone(r);
                    return (
                      <TableRow key={`${r.product_id}@${r.location_id}`}>
                        <TableCell>{r.product}</TableCell>
                        <TableCell>{r.location}</TableCell>
                        <TableCell align="right">{r.counted_qty}</TableCell>
                        <TableCell align="right">{r.system_qty_now}</TableCell>
                        <TableCell align="right">{r.sales_since_count}</TableCell>
                        <TableCell align="right">{r.expected_qty_now}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" color={tone.color} label={tone.label} />
                        </TableCell>
                        <TableCell align="right">{r.value_at_risk ? peso(r.value_at_risk) : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {rows.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>What this does and does not say</Typography>
                  {caveats(summary).map(c => (
                    <Typography key={c} variant="caption" color="text.secondary" display="block">
                      · {c}
                    </Typography>
                  ))}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Row detail: {describeRow(rows[0])}
                  </Typography>
                </>
              )}
            </>
          )}
        </Paper>
      </Box>
    </AdminLayout>
  );
}
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { getSettings, updateSettings } from '../../api';
import AdminLayout from '../layout/AdminLayout';

// SYSTEM SETTINGS (Governance → System Settings)
//
// The live knobs of the deployment, editable in place by the Owner / Super
// Admin (PUT /api/settings is management-tier; the server enforces it and
// audits every change). Each control explains what it drives so a panel can
// follow the knob from UI → API → effect.
const FSN_WINDOWS = [7, 30, 90, 180, 365];
const FSN_LABELS = { 7: '7 (Days preset)', 30: '30 (Weeks preset)', 90: '90 (Months preset)', 180: '180 (Quarterly preset)', 365: '365 (Annually preset)' };

export default function SettingsPage({ user, onLogout }) {
  const isManagement = ['super_admin', 'owner'].includes(user?.role);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async() => {
    try {
      const data = await getSettings();
      setForm(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => form?._dirty === true, [form]);

  const change = (key, value) => setForm((f) => ({ ...f, [key]: value, _dirty: true }));

  const save = async() => {
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const result = await updateSettings({
        demo_accounts_disabled: Boolean(form.demo_accounts_disabled),
        fsn_window_days: Number(form.fsn_window_days),
        low_stock_multiplier: Number(form.low_stock_multiplier),
        session_token_hours: Number(form.session_token_hours),
        stocktake_cycle_days: Number(form.stocktake_cycle_days),
        eoq_ordering_cost: Number(form.eoq_ordering_cost),
        eoq_annual_holding_rate: Number(form.eoq_annual_holding_rate),
        reorder_lead_time_days: Number(form.reorder_lead_time_days),
        safety_stock_z_score: Number(form.safety_stock_z_score),
        abc_a_threshold_percent: Number(form.abc_a_threshold_percent),
        abc_b_threshold_percent: Number(form.abc_b_threshold_percent),
        lot_allocation_policy: form.lot_allocation_policy,
      });
      setForm({ ...result.settings, _dirty: false });
      setToast('Settings saved — changes take effect immediately.');
    } catch (err) {
      const details = err.body?.details;
      setError(details ? details.join(' · ') : err.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout title="System Settings" onLogout={onLogout}>
        <Typography sx={{ p: 3 }}>Loading settings…</Typography>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="System Settings" onLogout={onLogout}>
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h5">System Settings</Typography>
          <Chip size="small" color={isManagement ? 'success' : 'default'} label={isManagement ? 'Owner / Super Admin — can edit' : 'Admin — read-only'} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Live runtime configuration for the whole deployment. Changes apply immediately — no redeploy —
        and every change is recorded in the Audit Trail.
        </Typography>

        {error ? <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert> : null}

        {form ? (
          <Paper sx={{ p: 3, display: 'grid', gap: 3, maxWidth: 720 }}>
            <Alert severity="info">
            Replenishment values start with demonstration assumptions. Replace them with Sylver’s purchasing cost, supplier lead time, and desired service target before relying on purchase recommendations. Changes are logged in the Audit Trail.
            </Alert>

            <TextField
              select
              label="Demo accounts"
              value={form.demo_accounts_disabled ? 'disabled' : 'enabled'}
              onChange={(e) => change('demo_accounts_disabled', e.target.value === 'disabled')}
              disabled={!isManagement || saving}
              helperText={
                form.demo_accounts_disabled
                  ? 'Seeded demo logins (admin/customer/staff/owner/superadmin) are refused with the generic "invalid username or password" — the OWASP no-default-accounts rule.'
                  : 'Seeded demo accounts can sign in (convenient for demos). Disable before going to production.'
              }
            >
              <MenuItem value="enabled">Enabled — demo logins work (demo mode)</MenuItem>
              <MenuItem value="disabled">Disabled — demo logins refused (production mode)</MenuItem>
            </TextField>

            <TextField
              select
              label="Default FSN / analytics window"
              value={Number(form.fsn_window_days)}
              onChange={(e) => change('fsn_window_days', Number(e.target.value))}
              disabled={!isManagement || saving}
              helperText="The Fast/Slow/Non-moving classification and the dashboard ranges default to this window. An explicit date-range filter on a page still wins."
            >
              {FSN_WINDOWS.map((d) => (
                <MenuItem key={d} value={d}>{FSN_LABELS[d] || `${d} days`}</MenuItem>
              ))}
            </TextField>

            <TextField
              label="Low-stock badge factor"
              type="number"
              inputProps={{ step: 0.1, min: 1, max: 3 }}
              value={form.low_stock_multiplier}
              onChange={(e) => change('low_stock_multiplier', e.target.value)}
              disabled={!isManagement || saving}
              helperText="A product shows the Low Stock badge when its quantity is at or below its critical level × this factor (1.0 = only at the critical line, 1.5 = the default early warning)."
            />

            <TextField
              select
              label="Session lifetime (hours)"
              value={Number(form.session_token_hours)}
              onChange={(e) => change('session_token_hours', Number(e.target.value))}
              disabled={!isManagement || saving}
              helperText="How long a login stays valid before re-authentication is required. Applies to tokens issued after the change; existing sessions keep their original expiry. Logging out revokes a session immediately regardless of this value."
            >
              {[1, 4, 8, 12, 24, 48, 72, 168].map((h) => (
                <MenuItem key={h} value={h}>{h} {h === 1 ? 'hour' : 'hours'}{h === 8 ? ' (a shift)' : ''}{h === 24 ? ' (default)' : ''}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Stocktake recount cycle"
              value={Number(form.stocktake_cycle_days)}
              onChange={(e) => change('stocktake_cycle_days', Number(e.target.value))}
              disabled={!isManagement || saving}
              helperText="How long a count stays fresh before its shelf is due to be walked again. A shelf counts as re-counted only when EVERY line stocked on it is inside this window, so a partial walk never resets the clock — see the Stocktake Schedule."
            >
              {[7, 14, 30, 60, 90, 180, 365].map((d) => (
                <MenuItem key={d} value={d}>
                  {d} days{d === 30 ? ' (default — monthly)' : d === 7 ? ' (weekly)' : d === 90 ? ' (quarterly)' : d === 365 ? ' (yearly)' : ''}
                </MenuItem>
              ))}
            </TextField>

            <Typography variant="subtitle1" sx={{ mb: -2 }}>Inventory planning assumptions</Typography>
            <TextField
              label="Cost to place one order (₱)"
              type="number"
              inputProps={{ step: 1, min: 0.01, max: 1000000 }}
              value={form.eoq_ordering_cost}
              onChange={(e) => change('eoq_ordering_cost', e.target.value)}
              disabled={!isManagement || saving}
              helperText="EOQ uses this as the order setup cost per replenishment. Demo default: ₱50."
            />
            <TextField
              label="Annual holding cost rate"
              type="number"
              inputProps={{ step: 0.01, min: 0.01, max: 5 }}
              value={form.eoq_annual_holding_rate}
              onChange={(e) => change('eoq_annual_holding_rate', e.target.value)}
              disabled={!isManagement || saving}
              helperText="Fraction of one unit’s cost spent holding it for a year; 0.20 means 20%."
            />
            <TextField
              label="Supplier lead time (days)"
              type="number"
              inputProps={{ step: 1, min: 1, max: 365 }}
              value={form.reorder_lead_time_days}
              onChange={(e) => change('reorder_lead_time_days', e.target.value)}
              disabled={!isManagement || saving}
              helperText="Used by the reorder point calculation. Demo default: 7 days."
            />
            <TextField
              label="Safety stock service factor (Z)"
              type="number"
              inputProps={{ step: 0.01, min: 0.01, max: 4 }}
              value={form.safety_stock_z_score}
              onChange={(e) => change('safety_stock_z_score', e.target.value)}
              disabled={!isManagement || saving}
              helperText="Multiplies daily-demand variation; 1.65 is approximately a 95% service target under a normal-demand assumption."
            />
            <TextField
              label="ABC A-class cumulative limit (%)"
              type="number"
              inputProps={{ step: 1, min: 1, max: 99 }}
              value={form.abc_a_threshold_percent}
              onChange={(e) => change('abc_a_threshold_percent', e.target.value)}
              disabled={!isManagement || saving}
              helperText="Default: 70%. The B-class limit must be higher."
            />
            <TextField
              label="ABC B-class cumulative limit (%)"
              type="number"
              inputProps={{ step: 1, min: 2, max: 100 }}
              value={form.abc_b_threshold_percent}
              onChange={(e) => change('abc_b_threshold_percent', e.target.value)}
              disabled={!isManagement || saving}
              helperText="Default: 90%; products beyond this cumulative sales value are class C."
            />
            <TextField
              select
              label="Batch allocation policy"
              value={form.lot_allocation_policy}
              onChange={(e) => change('lot_allocation_policy', e.target.value)}
              disabled={!isManagement || saving}
              helperText="FEFO prioritizes the earliest expiry for dated products. FIFO prioritizes the oldest received lot."
            >
              <MenuItem value="FEFO">FEFO (recommended for dated products)</MenuItem>
              <MenuItem value="FIFO">FIFO (oldest received first)</MenuItem>
            </TextField>

            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="contained"
                onClick={save}
                disabled={!isManagement || saving || !dirty}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {!isManagement && (
                <Typography variant="caption" color="text.secondary">
                Ask an Owner or Super Admin to change these values.
                </Typography>
              )}
            </Stack>
          </Paper>
        ) : null}

        <Snackbar
          open={!!toast}
          autoHideDuration={4000}
          onClose={() => setToast('')}
          message={toast}
        />
      </Box>
    </AdminLayout>
  );
}

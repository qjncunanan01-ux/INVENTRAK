import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { apiDelete, apiGet, apiPost } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

// Unit / packaging conversion catalog. One linear rate per (from -> to) pair,
// e.g. kg -> g = 1000. The backend normalizes units to lower-case and refuses
// identity rows, so the form does not need to.
export default function UnitConversionsPage({ onLogout }) {
  usePageTitle('/unit-conversions');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fromUnit, setFromUnit] = useState('');
  const [toUnit, setToUnit] = useState('');
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet('/api/unit-conversions');
      setRows(Array.isArray(response) ? response : []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Common packaging conversions, offered as one-tap presets so the demo does
  // not depend on typing exact unit spellings.
  const presets = [
    { from_unit: 'kg', to_unit: 'g', rate: 1000 },
    { from_unit: 'g', to_unit: 'kg', rate: 0.001 },
    { from_unit: 'l', to_unit: 'ml', rate: 1000 },
    { from_unit: 'ml', to_unit: 'l', rate: 0.001 },
    { from_unit: 'pack', to_unit: 'pcs', rate: 12 },
  ];

  const submit = async (body) => {
    setSaving(true);
    try {
      await apiPost('/api/unit-conversions', body);
      setSnackbar({ open: true, message: 'Conversion saved', severity: 'success' });
      await load();
      return true;
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const ok = await submit({
      from_unit: fromUnit,
      to_unit: toUnit,
      rate: Number(rate),
      note: note || null,
    });
    if (ok) {
      setFromUnit('');
      setToUnit('');
      setRate('');
      setNote('');
    }
  };

  const handleDelete = async () => {
    if (confirmDelete == null) return;
    setSaving(true);
    try {
      await apiDelete(`/api/unit-conversions/${confirmDelete}`);
      setSnackbar({ open: true, message: 'Conversion deleted', severity: 'success' });
      await load();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
      setConfirmDelete(null);
    }
  };

  return (
    <AdminLayout title="Unit & Packaging Conversions" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Add or update a conversion</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Define how one unit converts into another — for example 1 kg = 1000 g. Units are matched
          case-insensitively; an identity row (kg → kg) is refused.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <TextField
            size="small"
            label="From unit"
            value={fromUnit}
            onChange={(e) => setFromUnit(e.target.value)}
            sx={{ minWidth: 150, backgroundColor: colors.surface }}
          />
          <TextField
            size="small"
            label="To unit"
            value={toUnit}
            onChange={(e) => setToUnit(e.target.value)}
            sx={{ minWidth: 150, backgroundColor: colors.surface }}
          />
          <TextField
            size="small"
            label="Rate (to = from × rate)"
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            sx={{ minWidth: 200, backgroundColor: colors.surface }}
          />
          <TextField
            size="small"
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            sx={{ minWidth: 220, flex: 1, backgroundColor: colors.surface }}
          />
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={saving || !fromUnit.trim() || !toUnit.trim() || !rate}
          >
            Save conversion
          </Button>
        </Box>
        <Typography variant="subtitle2" mb={1}>Quick presets</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {presets.map((p) => (
            <Button
              key={`${p.from_unit}-${p.to_unit}`}
              size="small"
              variant="outlined"
              disabled={saving}
              onClick={() => submit(p)}
              sx={{ textTransform: 'none' }}
            >
              {p.from_unit} → {p.to_unit} ({p.rate})
            </Button>
          ))}
        </Box>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Conversion catalog</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>From</TableCell>
                <TableCell>To</TableCell>
                <TableCell>Rate</TableCell>
                <TableCell>Note</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5}>Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5}>No conversions defined yet</TableCell></TableRow>
              ) : rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.from_unit}</TableCell>
                  <TableCell>{c.to_unit}</TableCell>
                  <TableCell>{c.rate}</TableCell>
                  <TableCell>{c.note || '—'}</TableCell>
                  <TableCell>
                    <Button size="small" color="error" variant="contained" onClick={() => setConfirmDelete(c.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Delete confirmation implemented as a simple inline Paper rather than a
          Dialog so the page has no extra imports; keeps the flow explicit. */}
      {confirmDelete != null && (
        <Paper sx={{ p: 3, mt: 3, backgroundColor: colors.surfaceAlt }}>
          <Typography variant="h6" mb={1}>Delete this conversion?</Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button onClick={handleDelete} variant="contained" color="error" disabled={saving}>Delete</Button>
          </Box>
        </Paper>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

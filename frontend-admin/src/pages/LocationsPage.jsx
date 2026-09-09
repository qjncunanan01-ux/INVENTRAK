import QrCode2Icon from '@mui/icons-material/QrCode2';
import PrintIcon from '@mui/icons-material/Print';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';

// QR payload format for a location tag. The mobile scanner parses this exact
// prefix + location id so a scan opens that storage area's stock view.
const locationQrPayload = (loc) => `INVENTRAK:LOC:${loc.id}:${encodeURIComponent(loc.name)}`;

// Render the QR tag image via the same public qrserver.com API the MFA page
// already uses (no new dependency, no server round-trip needed to generate).
const locationQrUrl = (loc, size = 260) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(locationQrPayload(loc))}`;

export default function LocationsPage({ onLogout }) {
  usePageTitle('/locations');
  const [locations, setLocations] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState('');
  // QR-tag dialog state (null = closed; otherwise the location list to show).
  const [showQr, setShowQr] = useState(false);

  const loadLocations = async () => {
    setLoading(true);
    try {
      const response = await apiGet('/api/locations');
      setLocations(response);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLocations(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/api/locations', { name: name.trim() });
      setName('');
      setSnackbar({ open: true, message: 'Location added', severity: 'success' });
      await loadLocations();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await apiDelete(`/api/locations/${confirmDelete}`);
      setSnackbar({ open: true, message: 'Location deleted', severity: 'success' });
      await loadLocations();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
      setConfirmDelete(null);
    }
  };

  const locList = (Array.isArray(locations) ? locations : []).filter(loc => {
    const q = search.trim().toLowerCase();
    return !q || (loc.name || '').toLowerCase().includes(q);
  });

  return (
    <AdminLayout title="Location Management" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Manage inventory locations</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Add or remove stockroom locations used for tracking inventory levels.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <TextField
            label="New location"
            value={name}
            onChange={e => setName(e.target.value)}
            sx={{ minWidth: 320, flex: 1, backgroundColor: colors.surface }}
          />
          <Button variant="contained" onClick={handleCreate} disabled={saving || !name.trim()}>
            Add location
          </Button>
        </Box>
      </Paper>
      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="h6">Locations</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={() => setShowQr(true)}
              disabled={locList.length === 0}
              sx={{ color: colors.brandPrimary, borderColor: colors.brandPrimary }}
            >
              QR tags
            </Button>
            <TextField
              size="small"
              label="Search locations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 220, backgroundColor: colors.surface }}
            />
          </Box>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>QR tag</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4}>Loading…</TableCell></TableRow>
            ) : locList.length === 0 ? (
              <TableRow><TableCell colSpan={4}>No locations available</TableCell></TableRow>
            ) : locList.map(loc => (
              <TableRow key={loc.id}>
                <TableCell>{loc.id}</TableCell>
                <TableCell>{loc.name}</TableCell>
                <TableCell>
                  <Box
                    component="img"
                    src={locationQrUrl(loc, 44)}
                    alt={`QR tag for ${loc.name}`}
                    sx={{ width: 44, height: 44, borderRadius: 1, border: '1px solid rgba(0,0,0,0.12)' }}
                  />
                </TableCell>
                <TableCell>
                  <Button size="small" color="error" variant="contained" onClick={() => setConfirmDelete(loc.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete this location? This may affect inventory records.</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* QR location tags — printable tags for Showroom / Stockroom 1 /
          Stockroom 2. Each encodes INVENTRAK:LOC:<id>:<name> so the mobile
          staff scanner opens that storage area's stock view on scan. */}
      <Dialog open={showQr} onClose={() => setShowQr(false)} maxWidth="md" fullWidth>
        <DialogTitle>Location QR tags</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Print and stick one tag on each storage area. Scanning a tag in the mobile app opens
            that location's live stock view.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 2 }}>
            {locList.map(loc => (
              <Box
                key={loc.id}
                sx={{
                  border: '1px solid rgba(0,0,0,0.12)',
                  borderRadius: 2,
                  p: 2,
                  textAlign: 'center',
                  backgroundColor: colors.surface,
                }}
              >
                <Box
                  component="img"
                  src={locationQrUrl(loc)}
                  alt={`QR tag for ${loc.name}`}
                  sx={{ width: 180, height: 180, mx: 'auto', display: 'block' }}
                />
                <Typography variant="subtitle2" sx={{ mt: 1 }}>{loc.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                  {locationQrPayload(loc)}
                </Typography>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowQr(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={() => window.print()}
            sx={{ backgroundColor: colors.brandPrimary }}
          >
            Print tags
          </Button>
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

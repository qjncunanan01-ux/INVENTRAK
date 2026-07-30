import { Box, Button, Dialog, DialogActions, DialogTitle, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

export default function LocationsPage({ onLogout }) {
  const [locations, setLocations] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDelete, setConfirmDelete] = useState(null);

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

  const locList = Array.isArray(locations) ? locations : [];

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
        <Typography variant="h6" mb={2}>Locations</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={3}>Loading...</TableCell></TableRow>
            ) : locList.length === 0 ? (
              <TableRow><TableCell colSpan={3}>No locations available</TableCell></TableRow>
            ) : locList.map(loc => (
              <TableRow key={loc.id}>
                <TableCell>{loc.id}</TableCell>
                <TableCell>{loc.name}</TableCell>
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

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

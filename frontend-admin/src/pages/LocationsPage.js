import { Box, Button, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function LocationsPage({ onLogout }) {
  const [locations, setLocations] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadLocations = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/locations`);
      setLocations(response.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await axios.post(`${API_BASE_URL}/api/locations`, { name: name.trim() });
      setName('');
      await loadLocations();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setSaving(true);
    try {
      await axios.delete(`${API_BASE_URL}/api/locations/${id}`);
      await loadLocations();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="Location Management" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>Manage inventory locations</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="New location"
            value={name}
            onChange={e => setName(e.target.value)}
            sx={{ minWidth: 320 }}
          />
          <Button variant="contained" onClick={handleCreate} disabled={saving || !name.trim()}>
            Add location
          </Button>
        </Box>
      </Paper>
      <Paper sx={{ p: 3 }}>
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
            ) : locations.length === 0 ? (
              <TableRow><TableCell colSpan={3}>No locations available</TableCell></TableRow>
            ) : locations.map(loc => (
              <TableRow key={loc.id}>
                <TableCell>{loc.id}</TableCell>
                <TableCell>{loc.name}</TableCell>
                <TableCell>
                  <Button size="small" color="error" onClick={() => handleDelete(loc.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}

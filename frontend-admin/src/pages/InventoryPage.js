import { Paper, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../api';
import AdminLayout from './AdminLayout';

export default function InventoryPage({ onLogout }) {
  const [inventory, setInventory] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/inventory`).then(r => {
      setInventory(r.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <AdminLayout title="Inventory Management" onLogout={onLogout}>
      <Paper sx={{ p: 3 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              {inventory.locations.map(loc => <TableCell key={loc}>{loc}</TableCell>)}
              <TableCell>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={inventory.locations.length + 2}>Loading...</TableCell></TableRow>
            ) : inventory.items.length === 0 ? (
              <TableRow><TableCell colSpan={inventory.locations.length + 2}>No inventory data</TableCell></TableRow>
            ) : inventory.items.map(item => (
              <TableRow key={item.product.id}>
                <TableCell>{item.product.name}</TableCell>
                {inventory.locations.map(loc => <TableCell key={loc}>{item.locations[loc] ?? 0}</TableCell>)}
                <TableCell>{item.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}

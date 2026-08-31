import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const eventLabel = (event) => {
  const labels = {
    'auth.login.success': 'Login',
    'auth.login.failed': 'Failed Login',
    'auth.logout': 'Logout',
    'auth.register': 'Registration',
    'auth.email_verified': 'Email Verified',
    'auth.mfa.enabled': 'MFA Enabled',
    'auth.mfa.disabled': 'MFA Disabled',
    'auth.mfa.failed': 'MFA Failed',
    'stock.create': 'Stock Created',
    'stock.update': 'Stock Updated',
    'stock.delete': 'Stock Deleted',
    'stock.in': 'Stock In',
    'stock.out': 'Stock Out',
    'stock.transfer': 'Stock Transfer',
    'stock.adjustment': 'Stock Adjustment',
    'approval.approved': 'Approved',
    'approval.rejected': 'Rejected',
  };

  return labels[event] || event;
};

const eventColor = (event) => {
  if (event.includes('failed')) return 'error';
  if (event.includes('delete')) return 'error';
  if (event.includes('success')) return 'success';
  if (event.includes('approved')) return 'success';
  if (event.includes('rejected')) return 'error';
  return 'default';
};

export default function AuditTrailPage({ onLogout }) {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);

    try {
      const result = await apiGet('/api/audit-trail');
      setLogs(result.data || result || []);
    } catch (err) {
      console.error('Failed to load audit trail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const query = search.toLowerCase();

    return (
      String(log.event || '').toLowerCase().includes(query) ||
      String(log.username || '').toLowerCase().includes(query) ||
      String(log.action || '').toLowerCase().includes(query) ||
      String(log.module || '').toLowerCase().includes(query)
    );
  });

  return (
    <AdminLayout title="Audit Trail" onLogout={onLogout}>
      <Paper
        sx={{
          p: 3,
          mb: 3,
          backgroundColor: colors.surfaceAlt,
        }}
      >
        <Typography variant="h6" mb={1}>
          System Audit Trail
        </Typography>

        <Typography variant="body2" color="text.secondary" mb={2}>
          Review important activities and changes performed by users in the
          system.
        </Typography>

        <TextField
          fullWidth
          size="small"
          label="Search audit logs"
          placeholder="Search by user, action, or module..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ backgroundColor: colors.surface }}
        />
      </Paper>

      <Paper
        sx={{
          backgroundColor: colors.surfaceAlt,
          overflow: 'auto',
        }}
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>Date / Time</strong></TableCell>
              <TableCell><strong>User</strong></TableCell>
              <TableCell><strong>Action</strong></TableCell>
              <TableCell><strong>Module</strong></TableCell>
              <TableCell><strong>Description</strong></TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>
                  Loading audit trail...
                </TableCell>
              </TableRow>
            ) : filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  No audit records found.
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log, index) => (
                <TableRow key={log.id || index}>
                  <TableCell>
                    {log.t
                      ? new Date(log.t).toLocaleString()
                      : log.created_at
                        ? new Date(log.created_at).toLocaleString()
                        : '-'}
                  </TableCell>

                  <TableCell>
                    {log.username || '-'}
                  </TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      label={eventLabel(log.event || log.action || '')}
                      color={eventColor(log.event || '')}
                    />
                  </TableCell>

                  <TableCell>
                    {log.module || 'Authentication'}
                  </TableCell>

                  <TableCell>
                    {log.description ||
                      log.event ||
                      '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}
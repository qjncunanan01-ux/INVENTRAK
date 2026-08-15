import { Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const peso = (n) => 'P' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ReportsPage({ onLogout }) {
  const [report, setReport] = useState(null);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (d) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet(`/api/reports?days=${d}`);
      setReport(res);
    } catch (err) {
      setError('Failed to load report: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  const s = report?.summary || {};
  const statuses = report?.orderStatusSummary || {};

  return (
    <AdminLayout title="Reports" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <div>
          <Typography variant="h6" mb={0.5}>Management report</Typography>
          <Typography variant="body2" color="text.secondary">
            {report ? `Generated ${new Date(report.generated_at).toLocaleString()} · last ${report.days} days` : 'Loading report...'}
          </Typography>
        </div>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 140, backgroundColor: colors.surface }}>
            <InputLabel>Period</InputLabel>
            <Select value={days} label="Period" onChange={e => setDays(Number(e.target.value))}>
              <MenuItem value={7}>Last 7 days</MenuItem>
              <MenuItem value={14}>Last 14 days</MenuItem>
              <MenuItem value={30}>Last 30 days</MenuItem>
              <MenuItem value={90}>Last 90 days</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" color="secondary" onClick={() => window.print()} disabled={loading}>
            🖨 Print / Save PDF
          </Button>
        </Box>
      </Paper>

      {error ? <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}><Typography color="error">{error}</Typography></Paper> : null}

      {report ? (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', mb: 3 }}>
            {[
              ['Total products', s.total_products],
              ['Total stock', s.total_stock],
              ['Total sales', peso(s.total_sales)],
              ['Transactions', s.transactions],
              ['Customers served', s.customers_served],
              ['Pending approvals', s.pending_approvals],
            ].map(([label, value]) => (
              <Paper key={label} sx={{ p: 2, backgroundColor: colors.surfaceAlt, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography variant="h6">{value ?? '-'}</Typography>
              </Paper>
            ))}
          </Box>

          <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
            <Typography variant="h6" mb={2}>Daily sales value</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Transactions</TableCell>
                  <TableCell align="right">Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.dailySales.length === 0 ? (
                  <TableRow><TableCell colSpan={3}>No sales in this period.</TableCell></TableRow>
                ) : report.dailySales.map(d => (
                  <TableRow key={d.date}>
                    <TableCell>{d.date}</TableCell>
                    <TableCell>{d.transactions}</TableCell>
                    <TableCell align="right">{peso(d.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
            <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
              <Typography variant="h6" mb={2}>Available stocks per location</Typography>
              <Table size="small">
                <TableHead><TableRow><TableCell>Location</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead>
                <TableBody>
                  {report.stockByLocation.map(l => (
                    <TableRow key={l.location}><TableCell>{l.location}</TableCell><TableCell align="right">{l.total}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
              <Typography variant="h6" mb={2}>Order status summary</Typography>
              <Table size="small">
                <TableHead><TableRow><TableCell>Status</TableCell><TableCell align="right">Count</TableCell></TableRow></TableHead>
                <TableBody>
                  {Object.entries(statuses).map(([k, v]) => (
                    <TableRow key={k}><TableCell sx={{ textTransform: 'capitalize' }}>{k}</TableCell><TableCell align="right">{v}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
              <Typography variant="h6" mb={2}>Low-stock items (below 80)</Typography>
              <Table size="small">
                <TableHead><TableRow><TableCell>Product</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead>
                <TableBody>
                  {report.lowStock.length === 0 ? (
                    <TableRow><TableCell colSpan={2}>No low-stock items.</TableCell></TableRow>
                  ) : report.lowStock.map(l => (
                    <TableRow key={l.id}><TableCell>{l.name}</TableCell><TableCell align="right">{l.total}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
              <Typography variant="h6" mb={2}>Fast-moving products</Typography>
              <Table size="small">
                <TableHead><TableRow><TableCell>Product</TableCell><TableCell align="right">Units sold</TableCell><TableCell align="right">Value</TableCell></TableRow></TableHead>
                <TableBody>
                  {report.fastMovers.map(m => (
                    <TableRow key={m.name}><TableCell>{m.name}</TableCell><TableCell align="right">{m.qty_sold}</TableCell><TableCell align="right">{peso(m.value)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Box>
        </>
      ) : null}
    </AdminLayout>
  );
}

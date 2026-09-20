import { Box, Button, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, getCurrentUser } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import RangeFilter from '../components/RangeFilter';
import FormulaBanner from '../components/FormulaBanner';
import { MONEY_MASK } from '../components/Money';
import { DEFAULT_RANGE, resolveRange, rangeQuery } from '../dateRange';
import { canSeeMoney } from '../roles';

const moneyVisible = () => canSeeMoney(getCurrentUser()?.role || 'admin');

const peso = (n) => 'P' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Peso values are hidden entirely for roles without revenue visibility.
const money = (n) => (moneyVisible() ? peso(n) : MONEY_MASK);

export default function ReportsPage({ onLogout }) {
  usePageTitle('/reports');
  const [report, setReport] = useState(null);
  // Days / Weeks / Months / Quarterly / Annually — resolved to an explicit
  // from/to window the backend understands (it clamps both ends).
  const [rangePreset, setRangePreset] = useState(DEFAULT_RANGE);
  const range = useMemo(() => resolveRange(rangePreset), [rangePreset]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async(q) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet(`/api/reports${q}`);
      setReport(res);
    } catch (err) {
      setError('Failed to load report: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(rangeQuery(range)); }, [range.from, range.to]);

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
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <RangeFilter value={rangePreset} onChange={setRangePreset} />
          <Button variant="contained" color="secondary" onClick={() => window.print()} disabled={loading}>
            🖨 Print / Save PDF
          </Button>
        </Box>
      </Paper>

      {error ? <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}><Typography color="error">{error}</Typography></Paper> : null}

      {report ? (
        <>
          {/* Every peso figure in this report is one of these two sums — shown
              up top so the panel can trace each number to its source. */}
          <FormulaBanner
            title="Report math"
            items={[
              'Total sales   = Σ total_amount of all sales in the period   ·   Transactions = COUNT(sales)',
              'Daily sales   = Σ total_amount grouped per day (the "last N days" comes from the date filter)',
              'Fast movers   = Σ qty per product, ranked DESC   ·   Low-stock = products with total stock below the critical level',
            ]}
            note="Peso values stay masked for roles without revenue visibility — the math is public, the amounts are not."
          />
          <Box sx={{ height: 16 }} />
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', mb: 3 }}>
            {[
              ['Total products', s.total_products],
              ['Total stock', s.total_stock],
              ['Total sales', money(s.total_sales)],
              ['Transactions', s.transactions],
              ['Customers served', s.customers_served],
              ['Paying customers', s.customers_paid],
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
                    <TableCell align="right">{money(d.value)}</TableCell>
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
                    <TableRow key={m.name}><TableCell>{m.name}</TableCell><TableCell align="right">{m.qty_sold}</TableCell><TableCell align="right">{money(m.value)}</TableCell></TableRow>
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

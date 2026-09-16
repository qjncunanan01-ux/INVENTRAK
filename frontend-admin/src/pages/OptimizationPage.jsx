import { Box, Card, CardContent, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, getCurrentUser } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import FormulaBanner from '../components/FormulaBanner';
import RangeFilter from '../components/RangeFilter';
import { MONEY_MASK } from '../components/Money';
import { RANGE_PRESETS, resolveRange } from '../dateRange';
import { canSeeMoney } from '../roles';

// Movement-health colors for the FSN chips: Fast is healthy (green),
// Slow needs attention (amber), Non-moving is dead stock (red).
const FSN_CHIP_COLOR = { F: 'success', S: 'warning', N: 'error' };
const FSN_LABEL = { F: 'Fast-moving', S: 'Slow-moving', N: 'Non-moving' };

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');

// FSN's analysis window floors at 7 days server-side, so short presets map to
// the smallest supported window and "All" maps to the 730-day ceiling.
const FSN_MIN_WINDOW = 7;
const FSN_MAX_WINDOW = 730;
function fsnWindowFor(presetId) {
  const days = resolveRange(presetId).days;
  if (days === null) return FSN_MAX_WINDOW;
  return Math.min(FSN_MAX_WINDOW, Math.max(FSN_MIN_WINDOW, days));
}

export default function OptimizationPage({ onLogout }) {
  usePageTitle('/optimization');
  const [abc, setAbc] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // FSN analysis state: rows come pre-sorted Non-moving first, so the dead
  // stock an owner must act on is at the top of the table. The analysis window
  // is driven by the shared Days/Weeks/Months/Quarterly/Annually filter.
  const [fsn, setFsn] = useState([]);
  const [rangePreset, setRangePreset] = useState('quarter');
  const fsnWindow = useMemo(() => fsnWindowFor(rangePreset), [rangePreset]);
  const rangeCaption = RANGE_PRESETS.find((p) => p.id === rangePreset)?.caption || 'Last 90 days';
  const [fsnLoading, setFsnLoading] = useState(true);

  // Revenue is a money surface — Owner / Super Admin / Admin only.
  const moneyVisible = canSeeMoney(getCurrentUser()?.role || 'admin');

  const loadData = async () => {
    setLoading(true);
    try {
      const [abcRes, productsRes] = await Promise.all([
        apiGet('/api/optimization/abc'),
        apiGet('/api/products')
      ]);
      const abcData = abcRes.data || abcRes;
      const prodData = productsRes.data || productsRes;
      setAbc(abcData);
      setProducts(prodData);
      if (prodData.length) setSelectedProductId(prodData[0].id.toString());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadFsn = async (windowDays) => {
    setFsnLoading(true);
    try {
      const res = await apiGet(`/api/optimization/fsn?window=${windowDays}`);
      setFsn(Array.isArray(res.data || res) ? (res.data || res) : []);
    } catch (err) {
      console.error(err);
      setFsn([]);
    } finally {
      setFsnLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { loadFsn(fsnWindow); }, [fsnWindow]);

  useEffect(() => {
    if (!selectedProductId) return;
    apiGet(`/api/optimization/${selectedProductId}`)
      .then(r => setMetrics(r.data || r))
      .catch(() => setMetrics(null));
  }, [selectedProductId]);

  const abcList = (Array.isArray(abc) ? abc : []).filter(item => {
    const q = search.trim().toLowerCase();
    return !q || (item.name || '').toLowerCase().includes(q) || (item.classification || '').toLowerCase().includes(q);
  });
  const prodList = Array.isArray(products) ? products : [];

  const fsnList = (Array.isArray(fsn) ? fsn : []).filter(item => {
    const q = search.trim().toLowerCase();
    return !q || (item.name || '').toLowerCase().includes(q) || (item.classification || '').toLowerCase() === q;
  });
  const fsnCounts = fsnList.reduce((acc, item) => {
    acc[item.classification] = (acc[item.classification] || 0) + 1;
    return acc;
  }, { F: 0, S: 0, N: 0 });
  const fsnTotal = fsnList.length;

  const getClassificationColor = (cls) => {
    if (cls === 'A') return 'error';
    if (cls === 'B') return 'warning';
    return 'success';
  };

  return (
    <AdminLayout title="Inventory Optimization" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">ABC Classification</Typography>
            <Typography variant="body2" color="text.secondary">
              View product classification and prioritize inventory decisions.
            </Typography>
          </div>
          <TextField
            size="small"
            label="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 220, backgroundColor: colors.surface }}
          />
        </Box>
        <FormulaBanner
          title="ABC formula"
          items={[
            'annualValue = SUM(sales total_amount) per product   (price × 12 when no sales yet)',
            'rank products by annualValue DESC → cumulative share = cumValue ÷ totalValue × 100',
            'Class A: cumulative ≤ 70%   ·   Class B: ≤ 90%   ·   Class C: the rest',
          ]}
          note="A = the few products driving ~70% of revenue — protect their stock first."
        />
        <Box sx={{ height: 16 }} />
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Classification</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={3}>Loading…</TableCell></TableRow>
            ) : abcList.length === 0 ? (
              <TableRow><TableCell colSpan={3}>No optimization data available</TableCell></TableRow>
            ) : abcList.map(item => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.value}</TableCell>
                <TableCell>
                  <Chip label={item.classification} color={getClassificationColor(item.classification)} size="small" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">FSN Analysis (Fast / Slow / Non-moving)</Typography>
            <Typography variant="body2" color="text.secondary">
              Movement-based classification: how often each product sells and how recently. Non-moving items are surfaced first — they are dead stock candidates.
            </Typography>
          </div>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['F', 'S', 'N']).map(cls => (
              <Chip
                key={cls}
                label={`${FSN_LABEL[cls]}: ${fsnCounts[cls] || 0}`}
                color={FSN_CHIP_COLOR[cls]}
                size="small"
                variant={cls === 'N' ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600 }}
              />
            ))}
            {/* Days / Weeks / Months / Quarterly / Annually filter for the
                algorithm. Drives the FSN movement window below. */}
            <RangeFilter
              value={rangePreset}
              onChange={setRangePreset}
              label="Analysis window"
            />
          </Box>
        </Box>
        <FormulaBanner
          title="FSN formula"
          items={[
            'transactions = sales count in window   ·   frequency = window ÷ transactions   ·   recency = days since last sale',
            'N (Non-moving): transactions = 0   ·   F (Fast): frequency ≤ 7 days OR recency ≤ 7 days   ·   S (Slow): everything else',
            `window = ${fsnWindow} days (${rangeCaption}) — change it with the Analysis window filter`,
          ]}
          note="N items are dead-stock candidates — clear, discount, or stop reordering."
        />
        <Box sx={{ height: 16 }} />
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Class</TableCell>
              <TableCell align="right">Sales (txns)</TableCell>
              <TableCell align="right">Avg days between sales</TableCell>
              <TableCell align="right">Last sold (days ago)</TableCell>
              <TableCell align="right">Units sold</TableCell>
              <TableCell align="right">Revenue</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {fsnLoading ? (
              <TableRow><TableCell colSpan={7}>Analyzing movement…</TableCell></TableRow>
            ) : fsnList.length === 0 ? (
              <TableRow><TableCell colSpan={7}>No FSN data available</TableCell></TableRow>
            ) : fsnList.map(item => (
              <TableRow key={`${item.classification}-${item.id}`} sx={item.classification === 'N' ? { backgroundColor: 'rgba(211, 47, 47, 0.04)' } : undefined}>
                <TableCell>{item.name}</TableCell>
                <TableCell>
                  <Chip label={item.classification} color={FSN_CHIP_COLOR[item.classification]} size="small" />
                </TableCell>
                <TableCell align="right">{fmtNum(item.transactions)}</TableCell>
                <TableCell align="right">{item.frequencyDays === null ? '—' : fmtNum(item.frequencyDays)}</TableCell>
                <TableCell align="right">{item.recencyDays === null ? '—' : fmtNum(item.recencyDays)}</TableCell>
                <TableCell align="right">{fmtNum(item.totalQty)}</TableCell>
                <TableCell align="right">{moneyVisible ? `₱${fmtNum(item.valueSold)}` : MONEY_MASK}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {fsnTotal > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {fsnTotal} active products — {rangeCaption} ({fsnWindow} days) · F {fsnCounts.F} / S {fsnCounts.S} / N {fsnCounts.N} — non-moving items first.
          </Typography>
        )}
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <FormControl sx={{ minWidth: 240 }}>
            <InputLabel>Product</InputLabel>
            <Select value={selectedProductId} label="Product" onChange={e => setSelectedProductId(e.target.value)}>
              {prodList.map(product => (
                <MenuItem key={product.id} value={product.id.toString()}>{product.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        {metrics ? (
          <>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormulaBanner
              title="EOQ / ROP / Safety stock formulas"
              items={[
                'EOQ = √( 2·D·S ÷ H )        D = annual demand · S = ordering cost (₱50) · H = 20% × unit cost',
                'ROP  = daily demand × lead time (7 days)',
                'SS   = √D × 0.1             safety buffer for demand spikes',
                'Turnover = annual demand ÷ avg inventory',
              ]}
              note="Reorder when on-hand stock hits the ROP; EOQ is the cheapest batch size to reorder."
            />
            </Box>
            <Box sx={{ height: 16 }} />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Card sx={{ flex: 1, minWidth: 200, backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Economic Order Quantity</Typography>
                <Typography variant="h5">{metrics.EOQ}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, minWidth: 200, backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Reorder Point</Typography>
                <Typography variant="h5">{metrics.ROP}</Typography>
              </CardContent>
            </Card>
            <Card sx={{ flex: 1, minWidth: 200, backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Safety Stock</Typography>
                <Typography variant="h5">{metrics.safetyStock}</Typography>
              </CardContent>
            </Card>
            </Box>
          </>
        ) : (
          <Typography>Select a product to view EOQ, ROP, and safety stock metrics.</Typography>
        )}

        {metrics && metrics.turnoverRatio !== undefined && (
          <Box sx={{ mt: 2 }}>
            <Card sx={{ backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Inventory Turnover Ratio</Typography>
                <Typography variant="h5">{metrics.turnoverRatio.toFixed(2)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Avg Inventory: {metrics.avgInventory} | Annual Demand: {metrics.annualDemand}
                </Typography>
              </CardContent>
            </Card>
          </Box>
        )}

        {metrics && metrics.forecast !== undefined && (
          <Box sx={{ mt: 2 }}>
            <Card sx={{ backgroundColor: colors.surface, borderRadius: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Demand Forecast (Next Month)</Typography>
                <Typography variant="h5">{metrics.forecast}</Typography>
              </CardContent>
            </Card>
          </Box>
        )}
      </Paper>
    </AdminLayout>
  );
}

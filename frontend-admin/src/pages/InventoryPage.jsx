import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api';
import usePageTitle from '../hooks/usePageTitle';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';
import FormulaBanner from '../components/FormulaBanner';

// Status badge per inventory row. The backend stamps each item with its
// movement-aware critical_level (critical-level.js) + a stock_status badge;
// older payloads without those fields fall back to the legacy flat 80 bar.
const STATUS_META = {
  out_of_stock: { label: 'Out of Stock', color: 'error' },
  critical: { label: 'Critical', color: 'error' },
  low_stock: { label: 'Low Stock', color: 'warning' },
  in_stock: { label: 'In Stock', color: 'success' },
};

function statusFor(item) {
  const total = Number(item.total) || 0;
  const level = Number(item.critical_level);
  if (Number.isFinite(level) && level > 0) {
    if (total <= 0) return 'out_of_stock';
    if (total <= level) return 'critical';
    if (total <= Math.ceil(level * 1.5)) return 'low_stock';
    return 'in_stock';
  }
  return total < 80 ? 'low_stock' : 'in_stock';
}

// ---- Best-before (expiry) helpers ----
// Dated lots come from /api/stock-lots (FEFO ledger; staff counts stamp
// expiry_date on approval). The page aggregates the earliest open expiry per
// product so dated stock is visible right beside the stock levels.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Whole days from today until a YYYY-MM-DD date (negative = already past).
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function fmtDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Urgency bucket for the nearest expiry: drives the chip color + label.
function expiryMeta(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return null;
  if (days < 0) return { label: `Expired ${-days}d ago`, color: 'error', variant: 'filled', days };
  if (days === 0) return { label: 'Expires today', color: 'error', variant: 'filled', days };
  if (days <= 7) return { label: `${days}d left`, color: 'error', variant: 'outlined', days };
  if (days <= 30) return { label: `${days}d left`, color: 'warning', variant: 'outlined', days };
  return { label: `${days}d left`, color: 'success', variant: 'outlined', days };
}

// The filter values offered in the "Best before" dropdown.
const EXPIRY_FILTERS = [
  { value: 'expired', label: 'Expired only', test: (days) => days < 0 },
  { value: 'd7', label: 'Expiring ≤ 7 days', test: (days) => days >= 0 && days <= 7 },
  { value: 'd30', label: 'Expiring ≤ 30 days', test: (days) => days >= 0 && days <= 30 },
  { value: 'd90', label: 'Expiring ≤ 90 days', test: (days) => days >= 0 && days <= 90 },
  { value: 'dated', label: 'Dated only (any best-before)', test: () => true },
  { value: 'undated', label: 'No date recorded', test: null },
];

export default function InventoryPage({ onLogout }) {
  usePageTitle('/inventory');
  const [inventory, setInventory] = useState({ locations: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [search, setSearch] = useState('');
  // Best-before filter: '' = all rows, otherwise one of EXPIRY_FILTERS values.
  const [expiryFilter, setExpiryFilter] = useState('');
  // Nearest open expiry per product id (from the FEFO stock-lot ledger).
  const [nearestExpiry, setNearestExpiry] = useState({});

  // Scan-to-stock deep link: a scanned product QR opens /inventory?product=<id>
  // and a scanned location tag opens /inventory?location=<name>. Both simply
  // pre-apply the existing filters, so the operator lands on the exact view.
  const [searchParams] = useSearchParams();
  const [focusProductId, setFocusProductId] = useState(null);

  useEffect(() => {
    const loc = searchParams.get('location');
    const product = searchParams.get('product');
    if (loc) setSelectedLocation(loc);
    if (product && Number.isFinite(Number(product))) setFocusProductId(Number(product));
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (lowStockOnly) params.set('low_stock', 'true');
    if (selectedLocation) params.set('location', selectedLocation);
    const qs = params.toString();

    apiGet(`/api/inventory${qs ? '?' + qs : ''}`)
      .then(r => {
        const data = r.data || r;
        setInventory(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Dated lots for the Best-before column. Public endpoint, safe to fetch
    // alongside inventory; a failure just leaves the column undated. Fetched
    // unfiltered: the chip shows the earliest expiry across ALL locations
    // (location_id here is numeric, the Location dropdown is a name).
    apiGet('/api/stock-lots')
      .then(r => {
        const lots = Array.isArray(r) ? r : (r.data || []);
        // Earliest expiry wins per product (lots arrive FEFO-ordered from the
        // backend, but don't rely on it — reduce over every dated lot).
        const byProduct = {};
        for (const lot of lots) {
          if (!lot || lot.expiry_date == null || !(Number(lot.qty) > 0)) continue;
          const pid = lot.product_id;
          if (byProduct[pid] === undefined || lot.expiry_date < byProduct[pid].expiry_date) {
            byProduct[pid] = { expiry_date: lot.expiry_date, qty: Number(lot.qty) || 0 };
          }
        }
        setNearestExpiry(byProduct);
      })
      .catch(() => {});
  }, [lowStockOnly, selectedLocation]);

  const locs = (inventory.locations || []).map(loc => (typeof loc === 'object' ? loc : { id: loc, name: loc }));
  const items = (inventory.items || []).filter(item => {
    if (focusProductId !== null && Number(item.product?.id ?? item.id) !== focusProductId) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (item.product?.name || '').toLowerCase().includes(q) ||
      (item.product?.category || '').toLowerCase().includes(q);
  });

  // Best-before filter runs on top of the other filters. A row without a
  // dated lot counts as "undated".
  const filteredItems = items.filter(item => {
    if (!expiryFilter) return true;
    const entry = nearestExpiry[item.product?.id ?? item.id];
    const def = EXPIRY_FILTERS.find(f => f.value === expiryFilter);
    if (!def) return true;
    if (expiryFilter === 'undated') return !entry;
    if (expiryFilter === 'dated') return Boolean(entry);
    if (!entry) return false;
    const days = daysUntil(entry.expiry_date);
    return days !== null && def.test(days);
  });

  // Summary strip (the "root view"): headline numbers computed from the same
  // items the detail tables below break down per location. Stock In / Stock
  // Movement / Stock Adjustments pages remain the per-document details — this
  // is the at-a-glance rollup at the top of the module.
  const summary = useMemo(() => {
    const all = inventory.items || [];
    const totalUnits = all.reduce((s, it) => s + (Number(it.total) || 0), 0);
    const perStatus = { out_of_stock: 0, critical: 0, low_stock: 0, in_stock: 0 };
    let belowCriticalUnits = 0;
    for (const it of all) {
      perStatus[statusFor(it)] += 1;
      const lvl = Number(it.critical_level);
      if (Number.isFinite(lvl) && lvl > 0 && (Number(it.total) || 0) <= lvl) {
        belowCriticalUnits += lvl - (Number(it.total) || 0);
      }
    }
    return {
      skus: all.length,
      units: totalUnits,
      perLocation: locs.map((loc) => ({
        name: loc.name,
        units: all.reduce((s, it) => s + (Number(it.locations?.[loc.name]) || 0), 0),
      })),
      outOfStock: perStatus.out_of_stock,
      critical: perStatus.critical,
      lowStock: perStatus.low_stock,
      healthy: perStatus.in_stock,
      reorderUnits: belowCriticalUnits,
    };
  }, [inventory, locs]);

  const summaryCards = [
    { label: 'Total units on hand', value: summary.units, color: colors.brandPrimary, hint: 'All locations combined' },
    { label: 'Active SKUs', value: summary.skus, color: colors.textPrimary, hint: 'Products with an inventory row' },
    { label: 'Out of stock', value: summary.outOfStock, color: '#c62828', hint: 'Zero units everywhere' },
    { label: 'Critical', value: summary.critical, color: '#ef6c00', hint: 'At or below the critical level' },
    { label: 'Low stock', value: summary.lowStock, color: '#b26a00', hint: 'Within 150% of the critical level' },
    { label: 'Units to reorder', value: summary.reorderUnits, color: '#37648e', hint: 'Gap between stock and critical level' },
  ];

  return (
    <AdminLayout title="Inventory Management" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6">Inventory summary</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Rollup across all {locs.length} locations — stock-in documents, movements and adjustments are detailed in their own pages.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: 1.5 }}>
          {summaryCards.map((card) => (
            <Box
              key={card.label}
              sx={{
                p: 1.5,
                borderRadius: 2,
                backgroundColor: colors.surface,
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                {card.label}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: card.color }}>
                {card.value.toLocaleString()}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                {card.hint}
              </Typography>
            </Box>
          ))}
        </Box>
        {summary.perLocation.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            Per location:{' '}
            {summary.perLocation.map((loc, i) => (
              <span key={loc.name}>
                {i > 0 ? ' · ' : ''}{loc.name}: <strong>{loc.units.toLocaleString()}</strong>
              </span>
            ))}
          </Typography>
        )}
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">Inventory levels</Typography>
            <Typography variant="body2" color="text.secondary">Track stock distribution across locations.</Typography>
          </div>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              component={RouterLink}
              to="/scan-stock"
              size="small"
              variant="contained"
              startIcon={<CameraAltOutlined />}
              sx={{ backgroundColor: colors.brandPrimary }}
            >
              Scan & Stock
            </Button>
            <TextField
              size="small"
              label="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 220, backgroundColor: colors.surface }}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Location</InputLabel>
              <Select value={selectedLocation} label="Location" onChange={e => setSelectedLocation(e.target.value)}>
                <MenuItem value="">All locations</MenuItem>
                {locs.map(loc => <MenuItem key={loc.name} value={loc.name}>{loc.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150, backgroundColor: colors.surface }}>
              <InputLabel>Stock level</InputLabel>
              <Select value={lowStockOnly ? 'low' : ''} label="Stock level" onChange={e => setLowStockOnly(e.target.value === 'low')}>
                <MenuItem value="">All items</MenuItem>
                <MenuItem value="low">Low stock only</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 190, backgroundColor: colors.surface }}>
              <InputLabel>Best before</InputLabel>
              <Select value={expiryFilter} label="Best before" onChange={e => setExpiryFilter(e.target.value)}>
                <MenuItem value="">Any expiry</MenuItem>
                {EXPIRY_FILTERS.map(f => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
              </Select>
            </FormControl>
            {focusProductId !== null ? (
              <Chip
                color="primary"
                label={`Scanned product #${focusProductId} — clear`}
                onDelete={() => setFocusProductId(null)}
                aria-label={`Showing only the scanned product ${focusProductId}. Clear filter.`}
              />
            ) : null}
            <Typography variant="subtitle2" color="text.secondary">{locs.length} locations</Typography>
          </Box>
        </Box>
        <FormulaBanner
          title="Critical level formula (per product)"
          items={[
            'criticalLevel = max( floor(class), ceil(ratePerDay × leadTimeDays × (1 + z)) )',
            'ratePerDay = units sold per day (FSN window)  ·  z = service factor (how much buffer the class warrants)',
            'Fast: lead 7d, z 0.65, floor 120   ·   Slow: lead 14d, z 0.50, floor 60   ·   Non-moving: lead 30d, z 0.25, floor 32',
            'In Stock > 150% of level  ·  Low ≤ 150%  ·  Critical ≤ level  ·  Out = 0',
          ]}
          note="Movement-aware: a fast mover gets a much higher bar than dead stock, so alerts fire before a top seller runs dry."
        />
        <Box sx={{ height: 16 }} />
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              {locs.map(loc => <TableCell key={loc.name}>{loc.name}</TableCell>)}
              <TableCell>Total</TableCell>
              <TableCell>Critical Level</TableCell>
              <TableCell>
                <Tooltip title="Earliest expiry across open stock lots (FEFO ledger). Staff counts can stamp a best-before date; the dated lot is consumed first.">
                  <span>Best before</span>
                </Tooltip>
              </TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={locs.length + 5}>Loading…</TableCell></TableRow>
            ) : filteredItems.length === 0 ? (
              <TableRow><TableCell colSpan={locs.length + 5}>No inventory data</TableCell></TableRow>
            ) : filteredItems.map(item => {
              const status = statusFor(item);
              const meta = STATUS_META[status];
              const below = status === 'critical' || status === 'low_stock';
              const expiryEntry = nearestExpiry[item.product.id];
              const expiry = expiryEntry ? expiryMeta(expiryEntry.expiry_date) : null;
              return (
                <TableRow key={item.product.id} sx={{
                  backgroundColor: below ? 'rgba(249,168,37,0.08)' : 'inherit'
                }}>
                  <TableCell>{item.product.name}</TableCell>
                  {locs.map(loc => <TableCell key={loc.name}>{item.locations[loc.name] ?? 0}</TableCell>)}
                  <TableCell><strong>{item.total}</strong></TableCell>
                  <TableCell>{item.critical_level ?? 80}</TableCell>
                  <TableCell>
                    {expiry ? (
                      <Tooltip title={`${expiryEntry.qty} unit${expiryEntry.qty === 1 ? '' : 's'} on the dated lot · best before ${fmtDate(expiryEntry.expiry_date)} · FEFO consumes this lot first`}>
                        <Chip
                          label={expiry.label}
                          size="small"
                          color={expiry.color}
                          variant={expiry.variant}
                          aria-label={`${item.product.name} best before ${expiryEntry.expiry_date} — ${expiry.label}, ${expiryEntry.qty} units on the dated lot`}
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={meta.label} size="small" color={meta.color} variant={status === 'in_stock' ? 'outlined' : 'filled'} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </AdminLayout>
  );
}

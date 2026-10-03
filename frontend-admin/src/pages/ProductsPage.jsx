import { Alert, AlertTitle, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, createFilterOptions } from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, bulkUpdatePrices, bulkUpdateCosts, API_BASE_URL } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import QrTagSheet from '../components/QrTagSheet';
import QrImage from '../components/QrImage';
import { printElement } from '../printReport';
import { parseQrPayload, productQrPayload } from '../qr';
import { parseCostSheet, toCostPayload, summarizeCostSheet, buildCostTemplate } from '../cost-sheet';

const filter = createFilterOptions();

export default function ProductsPage({ onLogout }) {
  usePageTitle('/products');
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ name: '', category: '', brand: '', description: '', size: '', unit: '', price: '', cost: '', image: '' });
  const [saving, setSaving] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [search, setSearch] = useState('');
  // Bulk price-list upload state (CSV paste or file).
  const [bulkText, setBulkText] = useState('');
  const [bulkRows, setBulkRows] = useState([]); // parsed [{ id?, name, price }]
  const [bulkPreview, setBulkPreview] = useState(null); // { matched, unmatched }
  const [bulkResult, setBulkResult] = useState(null); // { updated, skipped }
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputRef = useRef(null);
  // Bulk cost-of-goods sheet state. Kept separate from the price state because
  // the two sheets have genuinely different semantics — a blank PRICE cell is
  // junk, a blank COST cell means "leave this one alone" (see cost-sheet.js).
  const [costText, setCostText] = useState('');
  const [costRows, setCostRows] = useState([]);
  const [costSummary, setCostSummary] = useState(null);
  const [costResult, setCostResult] = useState(null);
  const [costBusy, setCostBusy] = useState(false);
  const costFileRef = useRef(null);

  // QR tags: `activeTag` is the single-tag dialog, `showSheet` the batch
  // printable sheet, `scanValue` the scan-to-stock input box.
  const [activeTag, setActiveTag] = useState(null);
  // Printable region for the single-tag dialog's "Print tag" button.
  const singleTagRef = useRef(null);
  const [showSheet, setShowSheet] = useState(false);
  const [scanValue, setScanValue] = useState('');

  // Scan-to-stock: decode a pasted/scanned INVENTRAK payload and jump to the
  // matching screen. A product tag opens Scan & Stock pre-loaded with that
  // product; a location tag opens the inventory view filtered to that area.
  const handleScanSubmit = () => {
    const raw = scanValue.trim();
    const parsed = parseQrPayload(raw);
    if (!parsed) {
      setSnackbar({ open: true, message: 'Not an INVENTRAK QR tag — expected INVENTRAK:PROD:<id> or INVENTRAK:LOC:<id>:<name>.', severity: 'warning' });
      return;
    }
    setScanValue('');
    // Audit trail: record the scan (who/what/when) without blocking the jump.
    apiPost('/api/scan-events', {
      payload: raw,
      kind: parsed.kind,
      target_id: parsed.id,
      location: parsed.kind === 'location' ? parsed.name : null,
    }).catch(() => {});
    if (parsed.kind === 'product') {
      // Product tag → that product's stock across every location.
      navigate(`/inventory?product=${parsed.id}`);
    } else {
      // Location tag → the inventory view filtered to that storage area.
      navigate(`/inventory?location=${encodeURIComponent(parsed.name || '')}`);
    }
  };

  const prodArr = Array.isArray(products) ? products : [];
  const categoryOptions = Array.from(new Set(prodArr.map(p => p.category).filter(Boolean))).sort();
  const brandOptions = Array.from(new Set(prodArr.map(p => p.brand).filter(Boolean))).sort();
  const unitOptions = Array.from(new Set([...prodArr.map(p => p.unit), 'pcs', 'kg', 'g', 'L', 'mL', 'box', 'pack', 'bottle', 'can', 'bag'].filter(Boolean))).sort();

  const renderCreatableSelect = (label, value, onChangeField, options, placeholder) => (
    <Autocomplete
      value={value || ''}
      onChange={(event, newValue) => {
        if (typeof newValue === 'string') {
          onChangeField(newValue);
        } else if (newValue && newValue.inputValue) {
          onChangeField(newValue.inputValue);
        } else {
          onChangeField(newValue || '');
        }
      }}
      onInputChange={(event, newInputValue, reason) => {
        if (reason !== 'reset') {
          onChangeField(newInputValue);
        }
      }}
      filterOptions={(opts, params) => {
        const filtered = filter(opts, params);
        const { inputValue } = params;
        const trimmed = inputValue.trim();
        const isExisting = opts.some((option) => trimmed.toLowerCase() === option.toLowerCase());
        if (trimmed !== '' && !isExisting) {
          filtered.push({
            inputValue: trimmed,
            title: `Add "${trimmed}" as new`,
          });
        }
        return filtered;
      }}
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
      options={options}
      getOptionLabel={(option) => {
        if (typeof option === 'string') return option;
        if (option.inputValue) return option.inputValue;
        return option.title || '';
      }}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
        if (typeof option === 'object' && option.inputValue) {
          return (
            <li key={key} {...optionProps} style={{ fontWeight: 'bold', color: colors.primary }}>
              {option.title}
            </li>
          );
        }
        return (
          <li key={key} {...optionProps}>
            {option}
          </li>
        );
      }}
      freeSolo
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} variant="outlined" fullWidth />
      )}
    />
  );

  const loadProducts = () => {
    setLoading(true);
    // The public catalog deliberately strips `cost` (product-visibility.js), so
    // the cost sheet is fetched separately and merged in. Without this the
    // edit form below would hold no cost and the PUT — which full-replaces
    // every column — would wipe the cost of any product the admin merely
    // renamed. `cost` is admin-tier only, so the whole request is gated.
    Promise.all([apiGet('/api/products'), apiGet('/api/products/costs')])
      .then(([r, costs]) => {
        const rows = r.data || r;
        const byId = new Map((Array.isArray(costs) ? costs : []).map(c => [String(c.id), c]));
        setProducts(
          (Array.isArray(rows) ? rows : []).map(p => ({
            ...p,
            cost: byId.has(String(p.id)) ? byId.get(String(p.id)).cost : null,
          })),
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, []);

  const handleDelete = async() => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      await apiDelete(`/api/products/${confirmDelete}`);
      if (editingProductId === confirmDelete) {
        setEditingProductId(null);
        setForm({ name: '', category: '', brand: '', description: '', size: '', unit: '', price: '', cost: '', image: '' });
      }
      setSnackbar({ open: true, message: 'Product deleted', severity: 'success' });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
      setConfirmDelete(null);
    }
  };

  const formRef = useRef(null);

  const handleEdit = (product) => {
    setEditingProductId(product.id);
    setForm({
      name: product.name || '',
      category: product.category || '',
      brand: product.brand || '',
      description: product.description || '',
      size: product.size || '',
      unit: product.unit || '',
      price: product.price?.toString() || '',
      // Merged in by loadProducts from the admin cost sheet. Null renders as an
      // empty box, which is exactly "not costed" and round-trips as such.
      cost: product.cost === null || product.cost === undefined ? '' : String(product.cost),
      image: product.image || '',
    });
    // Scroll to the edit form at the top
    setTimeout(() => {
      formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleCreate = async() => {
    if (!form.name || !form.category) {
      setSnackbar({ open: true, message: 'Name and category are required', severity: 'warning' });
      return;
    }
    if (parseFloat(form.price) < 0) {
      setSnackbar({ open: true, message: 'Price cannot be negative', severity: 'warning' });
      return;
    }
    // Cost is optional and nullable. An empty box means "not costed" and is
    // sent as an explicit null so a cleared cost actually clears — the server
    // PUT full-replaces this column, so omitting it would silently keep stale
    // data while an empty string here reads as "I blanked it".
    if (form.cost !== '' && !(Number(form.cost) >= 0)) {
      setSnackbar({ open: true, message: 'Cost must be a positive number, or blank for "not costed"', severity: 'warning' });
      return;
    }
    const costValue = form.cost === '' ? null : Number(form.cost);
    setSaving(true);
    try {
      if (editingProductId) {
        await apiPut(`/api/products/${editingProductId}`, {
          name: form.name, category: form.category, brand: form.brand,
          description: form.description,
          size: form.size, unit: form.unit, price: parseFloat(form.price) || 0, cost: costValue, status: 'active', image: form.image,
        });
        setEditingProductId(null);
        setSnackbar({ open: true, message: 'Product updated', severity: 'success' });
      } else {
        await apiPost('/api/products', {
          name: form.name, category: form.category, brand: form.brand,
          description: form.description,
          size: form.size, unit: form.unit, price: parseFloat(form.price) || 0, cost: costValue, status: 'active', image: form.image,
        });
        setSnackbar({ open: true, message: 'Product created', severity: 'success' });
      }
      setForm({ name: '', category: '', brand: '', description: '', size: '', unit: '', price: '', cost: '', image: '' });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Only numeric characters (plus a single decimal point) can ever enter the
  // price field — letters/symbols are stripped as the user types.
  const sanitizePrice = (value) => {
    let v = String(value || '').replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    return v;
  };

  // --- Bulk price-list helpers ---

  // Parses pasted/uploaded CSV text into [{ id?, name, price }] rows.
  // Accepted layouts (header row optional):
  //   Product Name,Price
  //   id,name,price
  //   Name	Price  (tab-separated)
  //   Name,1,234.50
  const parseCsvRows = (text) => {
    const rows = [];
    const lines = String(text || '').split(/\r?\n/);
    let isHeader = true;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // Split on tab first (Excel paste), then on the LAST comma that is
      // followed by a number so product names containing commas survive.
      let cols;
      if (line.includes('\t')) cols = line.split('\t');
      else {
        const m = line.match(/^(.*?)[,\t]([₱P]?\s*[\d,.]+)$/);
        if (!m) continue;
        cols = [m[1].trim(), m[2].trim()];
      }
      // A 3-column tab row (id\tname\tprice) carries the name in the MIDDLE
      // column; the first is the numeric id we don't need for matching.
      const name = String(cols.length >= 3 ? cols[1] : cols[0] || '').trim().replace(/^["']|["']$/g, '');
      const priceStr = String(cols[cols.length - 1] || '').replace(/[^\d.]/g, '');
      const price = Number(priceStr);
      if (!name || !Number.isFinite(price)) continue;
      // Skip a header row like "name" / "Product Name" / "price" — only on
      // the first non-empty line, and only when the name column is exactly the
      // header word.
      if (isHeader && /^(name|product\s*name|price|id)$/i.test(name)) {
        isHeader = false;
        continue;
      }
      isHeader = false;
      rows.push({ name, price });
    }
    return rows;
  };

  const runBulkPreview = () => {
    const rows = parseCsvRows(bulkText);
    if (!rows.length) {
      setBulkPreview(null);
      setSnackbar({ open: true, message: 'No parseable rows. Use name,price per line (header row optional).', severity: 'warning' });
      return;
    }
    const lookup = new Map();
    for (const p of Array.isArray(products) ? products : []) lookup.set(String(p.name || '').trim().toLowerCase(), p);
    const matched = rows.filter(r => lookup.has(r.name.trim().toLowerCase()));
    setBulkRows(rows);
    setBulkResult(null);
    setBulkPreview({
      total: rows.length,
      matched: matched.length,
      unmatched: rows.filter(r => !lookup.has(r.name.trim().toLowerCase())).map(r => r.name),
    });
  };

  const applyBulkPrices = async() => {
    if (!bulkRows.length) {
      setSnackbar({ open: true, message: 'Parse the price list first', severity: 'warning' });
      return;
    }
    setBulkBusy(true);
    try {
      const res = await bulkUpdatePrices({ prices: bulkRows.map(r => ({ name: r.name, price: r.price })) });
      setBulkResult({ updated: res.updated, skipped: res.skipped || [] });
      setBulkText('');
      setBulkRows([]);
      setBulkPreview(null);
      setSnackbar({ open: true, message: `Updated ${res.updated} of ${res.total} prices`, severity: res.updated > 0 ? 'success' : 'warning' });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };

  // Downloads the current catalog as a name,price CSV so the user can fill in
  // real supplier prices in Excel and re-import (the 'fill all 192 in one go'
  // workflow this panel exists for).
  const downloadPriceTemplate = () => {
    const rows = Array.isArray(products) ? products.map(p => `${p.name},${p.price}`) : [];
    const csv = 'Product Name,Price\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventrak-prices.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBulkText(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- Bulk cost-of-goods helpers ---

  // Downloads the current cost sheet, with the selling price alongside the cost
  // so the margin is visible while typing. Uncosted products export a BLANK
  // cost cell, which re-imports as "leave alone" rather than "clear" — the
  // round trip is therefore lossless (see cost-sheet.js).
  const downloadCostTemplate = () => {
    const csv = buildCostTemplate(products);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventrak-costs.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runCostPreview = () => {
    const rows = parseCostSheet(costText);
    if (!rows.length) {
      setCostSummary(null);
      setSnackbar({ open: true, message: 'No parseable rows. Use Product Name,Cost per line (header row optional).', severity: 'warning' });
      return;
    }
    setCostRows(rows);
    setCostResult(null);
    setCostSummary(summarizeCostSheet(rows, products));
  };

  const applyCostSheet = async() => {
    const payload = toCostPayload(costRows);
    if (!payload.length) {
      setSnackbar({ open: true, message: 'Nothing to apply — every row was left blank. Type a cost, or "-" to clear one.', severity: 'warning' });
      return;
    }
    setCostBusy(true);
    try {
      const res = await bulkUpdateCosts({ costs: payload });
      setCostResult({ updated: res.updated, cleared: res.cleared || 0, skipped: res.skipped || [] });
      setCostText('');
      setCostRows([]);
      setCostSummary(null);
      const parts = [`${res.updated} cost${res.updated === 1 ? '' : 's'} set`];
      if (res.cleared) parts.push(`${res.cleared} cleared`);
      setSnackbar({ open: true, message: `${parts.join(', ')} of ${res.total}`, severity: res.updated > 0 || res.cleared > 0 ? 'success' : 'warning' });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCostBusy(false);
    }
  };

  const handleCostFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCostText(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  };

  const prodList = Array.isArray(products) ? products.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (p.name || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q);
  }) : [];

  return (
    <AdminLayout title="Product Management" onLogout={onLogout}>
      <Paper ref={formRef} sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Product catalog controls</Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Add, edit, and manage product details for inventory tracking.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField fullWidth variant="outlined" label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Grid>
          <Grid item xs={12} md={4}>{renderCreatableSelect('Category', form.category, val => setForm(prev => ({ ...prev, category: val })), categoryOptions)}</Grid>
          <Grid item xs={12} md={4}>{renderCreatableSelect('Brand', form.brand, val => setForm(prev => ({ ...prev, brand: val })), brandOptions)}</Grid>
          <Grid item xs={12} sm={6} md={4}><TextField fullWidth variant="outlined" label="Size (e.g. 1.5 KG, 2 L)" value={form.size} onChange={e => setForm(prev => ({ ...prev, size: e.target.value }))} /></Grid>
          <Grid item xs={12} sm={6} md={2}>{renderCreatableSelect('Unit', form.unit, val => setForm(prev => ({ ...prev, unit: val })), unitOptions, 'pcs')}</Grid>
          <Grid item xs={12} sm={6} md={3}><TextField fullWidth variant="outlined" label="Price" type="text" inputMode="decimal" inputProps={{ inputMode: 'decimal' }} value={form.price} onChange={e => setForm({ ...form, price: sanitizePrice(e.target.value) })} /></Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              variant="outlined"
              label="Cost of goods"
              type="text"
              inputProps={{ inputMode: 'decimal' }}
              value={form.cost}
              onChange={e => setForm({ ...form, cost: sanitizePrice(e.target.value) })}
              helperText="Blank = not costed"
            />
          </Grid>
          <Grid item xs={12} md={9}><TextField fullWidth variant="outlined" label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} multiline minRows={2} /></Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth variant="outlined" label="Image URL or /images/... path" value={form.image} onChange={e => setForm({ ...form, image: e.target.value })} placeholder="/images/da-vinci-sauces--butterscotch.jpg" />
          </Grid>
          {form.image ? (
            <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
              <img src={form.image.startsWith('http') ? form.image : API_BASE_URL + form.image} alt="preview" style={{ height: 56, borderRadius: 8, objectFit: 'cover' }} />
            </Grid>
          ) : null}
          <Grid item xs={12} sm={6} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
            <Button variant="contained" fullWidth onClick={handleCreate} disabled={saving || !form.name || !form.category}>
              {editingProductId ? 'Save product' : 'Create product'}
            </Button>
          </Grid>
          {editingProductId ? (
            <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button variant="outlined" fullWidth onClick={() => { setEditingProductId(null); setForm({ name: '', category: '', brand: '', description: '', size: '', unit: '', price: '', cost: '', image: '' }); }}>
                Cancel edit
              </Button>
            </Grid>
          ) : null}
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography variant="h6">Bulk price update</Typography>
          <Button size="small" variant="outlined" onClick={downloadPriceTemplate}>
            Download current prices (CSV)
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Paste a price list or upload a .csv file to set all prices in one go.
          Format: <code>Product Name,Price</code> per line (header row optional).
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              minRows={6}
              variant="outlined"
              placeholder={'Almond Roca,520\nBlueberry,495\nCaramel Syrup (750 ML) - Torani,499'}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button variant="contained" component="label">
              Upload .csv
              <input type="file" accept=".csv,text/csv,text/plain" hidden ref={fileInputRef} onChange={handleBulkFile} />
            </Button>
            <Button variant="outlined" onClick={runBulkPreview} disabled={!bulkText.trim()}>Parse preview</Button>
            <Button variant="contained" color="success" onClick={applyBulkPrices} disabled={bulkBusy || !bulkRows.length}>
              {bulkBusy ? 'Applying…' : `Apply ${bulkRows.length || ''} price${bulkRows.length === 1 ? '' : 's'}`}
            </Button>
          </Grid>
        </Grid>
        {bulkPreview ? (
          <Alert severity={bulkPreview.matched === bulkPreview.total ? 'success' : 'warning'} sx={{ mt: 2 }}>
            <AlertTitle>Parsed {bulkPreview.total} row{bulkPreview.total === 1 ? '' : 's'}</AlertTitle>
            {bulkPreview.matched} of {bulkPreview.total} names match the catalog.
            {bulkPreview.unmatched.length > 0 && (
              <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                {bulkPreview.unmatched.slice(0, 8).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
                {bulkPreview.unmatched.length > 8 && <li>…and {bulkPreview.unmatched.length - 8} more</li>}
              </Box>
            )}
          </Alert>
        ) : null}
        {bulkResult ? (
          <Alert severity={bulkResult.skipped.length === 0 ? 'success' : 'warning'} sx={{ mt: 2 }}>
            <AlertTitle>Applied — {bulkResult.updated} price{bulkResult.updated === 1 ? '' : 's'} updated</AlertTitle>
            {bulkResult.skipped.length > 0 && (
              <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                {bulkResult.skipped.slice(0, 8).map((s, i) => (
                  <li key={i}>{s.name}: {s.reason}</li>
                ))}
                {bulkResult.skipped.length > 8 && <li>…and {bulkResult.skipped.length - 8} more</li>}
              </Box>
            )}
          </Alert>
        ) : null}
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography variant="h6">Cost of goods</Typography>
          <Button size="small" variant="outlined" onClick={downloadCostTemplate}>
            Download current costs (CSV)
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Paste or upload a <code>Product Name,Cost</code> sheet to cost the whole catalog in one go
          (a <code>Product Name,Price,Cost</code> sheet works too — the exported template is that shape).
          A <strong>blank cost cell leaves that product alone</strong>; type <code>-</code> or <code>clear</code> to
          deliberately mark one as not costed. Costing a query is what makes the margin figures on
          Costing Records real — an uncosted product reports <code>cost_basis: &quot;none&quot;</code> rather than a guess.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              minRows={6}
              variant="outlined"
              placeholder={'Almond Roca,380\nBlueberry,295\nCaramel Syrup (750 ML) - Torani,-'}
              value={costText}
              onChange={e => setCostText(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button variant="contained" component="label">
              Upload .csv
              <input type="file" accept=".csv,text/csv,text/plain" hidden ref={costFileRef} onChange={handleCostFile} />
            </Button>
            <Button variant="outlined" onClick={runCostPreview} disabled={!costText.trim()}>Parse preview</Button>
            <Button variant="contained" color="success" onClick={applyCostSheet} disabled={costBusy || !costRows.length}>
              {costBusy ? 'Applying…' : `Apply ${costRows.length || ''} cost${costRows.length === 1 ? '' : 's'}`}
            </Button>
          </Grid>
        </Grid>
        {costSummary ? (
          <Alert severity={costSummary.unmatched.length === 0 ? 'success' : 'warning'} sx={{ mt: 2 }}>
            <AlertTitle>Parsed {costSummary.total} row{costSummary.total === 1 ? '' : 's'}</AlertTitle>
            {costSummary.willSet} cost{costSummary.willSet === 1 ? '' : 's'} will be set
            {costSummary.willClear > 0 ? `, ${costSummary.willClear} cleared back to "not costed"` : ''}
            {costSummary.willSkip > 0 ? `, ${costSummary.willSkip} left untouched (blank cost cell)` : ''}.
            {' '}{costSummary.matched} of {costSummary.total} names match the catalog.
            {costSummary.unmatched.length > 0 && (
              <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                {costSummary.unmatched.slice(0, 8).map((u, i) => (
                  <li key={i}>{u.name}: {u.reason}</li>
                ))}
                {costSummary.unmatched.length > 8 && <li>…and {costSummary.unmatched.length - 8} more</li>}
              </Box>
            )}
            {costSummary.lossMakers.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <strong>Check these — the cost is at or above the selling price:</strong>
                <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2 }}>
                  {costSummary.lossMakers.slice(0, 8).map((l, i) => (
                    <li key={i}>{l.name}: cost {l.cost} vs price {l.price}</li>
                  ))}
                </Box>
              </Box>
            )}
          </Alert>
        ) : null}
        {costResult ? (
          <Alert severity={costResult.skipped.length === 0 ? 'success' : 'warning'} sx={{ mt: 2 }}>
            <AlertTitle>Applied — {costResult.updated} set, {costResult.cleared} cleared</AlertTitle>
            {costResult.skipped.length > 0 && (
              <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                {costResult.skipped.slice(0, 8).map((s, i) => (
                  <li key={i}>{s.name}: {s.reason}</li>
                ))}
                {costResult.skipped.length > 8 && <li>…and {costResult.skipped.length - 8} more</li>}
              </Box>
            )}
          </Alert>
        ) : null}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Typography variant="h6">Active products</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            {/* Scan-to-stock: paste (or type) an INVENTRAK QR payload and jump
                straight to that product's stock view. Accepts exactly what the
                phone's scanner emits, so an admin can verify a tag on the
                spot. */}
            <TextField
              size="small"
              label="Scan / paste QR tag"
              value={scanValue}
              onChange={e => setScanValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleScanSubmit(); }}
              sx={{ minWidth: 240, backgroundColor: colors.surface }}
              helperText="e.g. INVENTRAK:PROD:12 or a location tag"
            />
            <Button size="small" variant="outlined" onClick={handleScanSubmit} disabled={!scanValue.trim()}>
              Go
            </Button>
            <TextField
              size="small"
              label="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ minWidth: 240, backgroundColor: colors.surface }}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={() => setShowSheet(true)}
              disabled={prodList.length === 0}
            >
              Product QR tags
            </Button>
            <Typography variant="body2" color="text.secondary">Total {prodList.length}</Typography>
          </Box>
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Photo</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Unit Measurement</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Cost</TableCell>
              <TableCell>Margin</TableCell>
              <TableCell>Brand</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9}>Loading…</TableCell></TableRow>
            ) : prodList.length === 0 ? (
              <TableRow><TableCell colSpan={9}>No products found</TableCell></TableRow>
            ) : prodList.map(product => (
              <TableRow key={product.id}>
                <TableCell>
                  {product.image ? (
                    <img src={product.image.startsWith('http') ? product.image : API_BASE_URL + product.image} alt={product.name} style={{ height: 48, width: 48, borderRadius: 8, objectFit: 'cover' }} />
                  ) : <Typography variant="body2" color="text.secondary">—</Typography>}
                </TableCell>
                <TableCell>{product.name}</TableCell>
                <TableCell>{product.category}</TableCell>
                <TableCell>{[product.size, product.unit].filter(Boolean).join(' ')}
                  {product.description && (
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>{product.description}</Typography>
                  )}
                </TableCell>
                <TableCell>P{product.price}</TableCell>
                {/* Cost and margin are admin-tier only, and arrive via the
                    separate cost sheet rather than the public catalog. */}
                <TableCell>
                  {product.cost === null || product.cost === undefined ? (
                    <Typography variant="caption" color="text.secondary">not costed</Typography>
                  ) : `P${product.cost}`}
                </TableCell>
                <TableCell>
                  {product.cost === null || product.cost === undefined || !(Number(product.price) > 0) ? (
                    <Typography variant="caption" color="text.secondary">—</Typography>
                  ) : `${Math.round(((Number(product.price) - Number(product.cost)) / Number(product.price)) * 100)}%`}
                </TableCell>
                <TableCell>{product.brand}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => handleEdit(product)}>Edit</Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<QrCode2Icon />}
                      aria-label={`Show QR tag for ${product.name}`}
                      onClick={() => setActiveTag(product)}
                    >
                      QR
                    </Button>
                    <Button size="small" variant="contained" color="error" onClick={() => setConfirmDelete(product.id)}>Delete</Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete this product? This action cannot be undone.</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Single product tag: printable on its own, and the payload shown so it
          can be verified/matched against the mobile scanner. */}
      <Dialog open={Boolean(activeTag)} onClose={() => setActiveTag(null)}>
        <DialogTitle>{activeTag ? `QR tag — ${activeTag.name}` : 'QR tag'}</DialogTitle>
        <DialogContent>
          {activeTag ? (
            <Box sx={{ textAlign: 'center' }} ref={singleTagRef}>
              {/* Local QR generation — no third-party request. */}
              <QrImage payload={productQrPayload(activeTag)} size={240} sx={{ mx: 'auto' }} />
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                {productQrPayload(activeTag)}
              </Typography>
              <Typography variant="body2" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Any phone camera can scan this tag — it opens the public product
                page. The INVENTRAK apps resolve it to the product's stock view.
                Old plain-payload tags (INVENTRAK:PROD:id) still scan in the
                apps; reprint to get camera-friendly tags.
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActiveTag(null)}>Close</Button>
          <Button variant="contained" color="secondary" onClick={() => printElement(singleTagRef.current)} disabled={!activeTag}>
            🖨 Print tag
          </Button>
        </DialogActions>
      </Dialog>

      {/* Batch sheet: every active product tag on one print-friendly page. */}
      <QrTagSheet
        open={showSheet}
        onClose={() => setShowSheet(false)}
        locations={[]}
        products={prodList}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}

import { Alert, AlertTitle, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress, Paper, Snackbar, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel, TextField, Tooltip, Typography, createFilterOptions } from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, bulkUpdatePrices, bulkUpdateCosts, getCurrentUser, API_BASE_URL } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import QrTagSheet from '../components/QrTagSheet';
import QrImage from '../components/QrImage';
import { printElement } from '../printReport';
import { parseQrPayload, productQrPayload } from '../qr';
import { parseCostSheet, toCostPayload, summarizeCostSheet, buildCostTemplate, sheetDiff, coverageOf, marginBucket, marginPercentOf, buildCostInsights } from '../cost-sheet';

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
  const [costDiff, setCostDiff] = useState([]); // [{ name, from, to, status }]

  // --- Cost work queue ---
  // Costing 204 products is only finishable if it can be resumed: without a
  // way to see what is left and jump straight to it, the sheet is a one-shot
  // chore nobody completes.
  const [bucket, setBucket] = useState('all'); // all | uncosted | loss | thin
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  // Inline editing: the product id currently being re-costed in the table, and
  // the value typed into it. Editing the cost where you see it beats clicking
  // Edit and being scrolled two screens up to a form that re-saves the whole
  // product.
  const [editingCostId, setEditingCostId] = useState(null);
  const [editingCostValue, setEditingCostValue] = useState('');
  const [costBusyId, setCostBusyId] = useState(null);
  // Recent bulk cost changes, read back from the durable audit trail.
  const [costHistory, setCostHistory] = useState([]);
  // The server's margin policy (COSTING_TARGET_MARGIN), so the panel grades
  // against the same target costing.js uses instead of a hardcoded 30.
  const [targetMargin, setTargetMargin] = useState(30);

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

  // The margin policy and the cost-change history are both one small read on
  // mount; neither is on the critical path, so a failure here leaves the page
  // fully usable on its defaults rather than erroring the whole screen.
  useEffect(() => {
    apiGet('/api/meta')
      .then(m => { if (m && m.costing && Number(m.costing.target_margin_percent) > 0) setTargetMargin(Number(m.costing.target_margin_percent)); })
      .catch(() => {});
    loadCostHistory();
  }, []);

  const loadCostHistory = async() => {
    try {
      const res = await apiGet('/api/audit-trail?limit=200');
      const rows = Array.isArray(res && res.data) ? res.data : [];
      setCostHistory(rows.filter(e => e && e.event === 'product.cost.bulk_update').slice(0, 6));
    } catch {
      // Non-fatal: history is context, not a requirement for costing anything.
    }
  };

  const coverage = useMemo(() => coverageOf(products), [products]);
  const insights = useMemo(() => buildCostInsights(products, targetMargin), [products, targetMargin]);

  // Set one product's cost without touching any other field.
  //
  // This deliberately calls the single-row form of /api/products/bulk-costs
  // rather than PUT /api/products/:id. That PUT full-replaces every column, so
  // using it for an inline cost edit would require shipping the entire product
  // back and would wipe `cost` if any field were missed — the exact failure
  // already fixed once in the edit form. bulk-costs touches one column by id and
  // cannot do that.
  const saveInlineCost = async(product, rawValue) => {
    const text = String(rawValue === undefined || rawValue === null ? '' : rawValue).trim();
    // An empty box means "not costed", which is an explicit clear rather than
    // an absent value — mirroring the bulk sheet's "leave blank alone" rule,
    // except here blankness is unambiguous: the user is editing that one cell.
    const cost = text === '' ? null : Number(text);
    if (cost !== null && !(Number.isFinite(cost) && cost >= 0)) {
      setSnackbar({ open: true, message: 'Cost must be a positive number, or blank for "not costed"', severity: 'warning' });
      return;
    }
    setCostBusyId(product.id);
    try {
      await bulkUpdateCosts({ costs: [{ id: product.id, cost }] });
      setEditingCostId(null);
      setProducts(prev => prev.map(p => (p.id === product.id ? { ...p, cost } : p)));
      setCostHistory(h => [{
        t: new Date().toISOString(),
        event: 'product.cost.bulk_update',
        actor: (getCurrentUser() && getCurrentUser().username) || 'you',
        updated: cost === null ? 0 : 1,
        cleared: cost === null ? 1 : 0,
        products: [product.name],
      }, ...h].slice(0, 6));
      setSnackbar({ open: true, message: `${product.name}: cost ${cost === null ? 'cleared' : 'set to ' + cost}`, severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setCostBusyId(null);
    }
  };

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
    // Per-row before/after, which is what the CLI script printed all along and
    // the browser did not — so the two tools disagreed about how much you could
    // see before committing a sheet.
    setCostDiff(sheetDiff(rows, products));
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
      setCostDiff([]);
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

  // Free-text search AND the cost work-queue bucket apply together: filtering
  // to "not costed" and then typing a category narrows to that slice of the
  // backlog rather than replacing it.
  const filteredProducts = (Array.isArray(products) ? products : []).filter(p => {
    if (bucket === 'uncosted' && marginBucket(p) !== 'uncosted') return false;
    if (bucket === 'loss' && marginBucket(p) !== 'loss') return false;
    if (bucket === 'thin' && marginBucket(p) !== 'thin') return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (p.name || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q);
  });

  // Sort, with one deliberate opinion: uncosted products always sink to the
  // bottom, in BOTH directions. A literal "sort by margin ascending" would
  // float all 201 unknowns to the top — technically correct, and useless,
  // because the unknowns are what the sort is being used to find.
  const prodList = [...filteredProducts].sort((a, b) => {
    if (sort.key !== 'name') {
      const aCosted = marginPercentOf(a) !== null;
      const bCosted = marginPercentOf(b) !== null;
      // Costed first, uncosted last: the unknown ones are what the admin opens
      // this sort to find.
      if (aCosted !== bCosted) return aCosted ? -1 : 1;
    }
    let av;
    let bv;
    if (sort.key === 'name') {
      av = String(a.name || '').toLowerCase();
      bv = String(b.name || '').toLowerCase();
    } else if (sort.key === 'price') {
      av = Number(a.price);
      bv = Number(b.price);
    } else if (sort.key === 'cost') {
      av = Number(a.cost);
      bv = Number(b.cost);
    } else {
      av = marginPercentOf(a);
      bv = marginPercentOf(b);
    }
    if (av === null && bv === null) return String(a.name || '').localeCompare(String(b.name || ''));
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return String(a.name || '').localeCompare(String(b.name || ''));
    return sort.dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  });

  const toggleSort = (key) => setSort(prev => (prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' }));

  // Puts the backlog on the clipboard so it can be pasted straight into the
  // cost sheet on the same page — the queue and the way of clearing it sit
  // next to each other instead of in different corners of the admin.
  const copyUncosted = async() => {
    const names = products.filter(p => marginBucket(p) === 'uncosted').map(p => p.name);
    if (!names.length) {
      setSnackbar({ open: true, message: 'Every product is already costed', severity: 'success' });
      return;
    }
    try {
      await navigator.clipboard.writeText(names.join('\n'));
      setSnackbar({ open: true, message: `Copied ${names.length} uncosted product name(s)`, severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: 'Could not reach the clipboard — select the filtered list instead.', severity: 'warning' });
    }
  };

  const bucketCounts = {
    all: products.length,
    uncosted: coverage.uncosted,
    loss: products.filter(p => marginBucket(p) === 'loss').length,
    thin: products.filter(p => marginBucket(p) === 'thin').length,
  };

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
        <Typography variant="h6" mb={1}>Margin overview</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          What the costs entered so far are actually worth. Margins are gross
          (price − cost) ÷ price over the <em>costed</em> products only —
          an uncosted product has no margin, not a 0% one, so it is left out of
          the maths rather than dragging it down.
        </Typography>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">COST COVERAGE</Typography>
            <Typography variant="h5">{coverage.costed} / {coverage.total}</Typography>
            <Typography variant="caption" color="text.secondary">{coverage.pct}% of the catalog costed</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">BLENDED MARGIN</Typography>
            <Typography variant="h5">
              {insights.blendedMargin === null ? '—' : `${Math.round(insights.blendedMargin)}%`}
            </Typography>
            {/* Value-weighted, not an average of per-product percentages — see
                buildCostInsights. "Catalogue-wide": the product record holds no
                quantity, so list price is the honest denominator, not turnover. */}
            <Typography variant="caption" color="text.secondary">weighted by list price</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">TARGET</Typography>
            <Typography variant="h5">{insights.target}%</Typography>
            <Typography variant="caption" color="text.secondary">
              {insights.underPriced.length} product(s) below it
            </Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="caption" color="text.secondary">COST ≥ PRICE</Typography>
            <Typography variant="h5" color={insights.lossMakers ? 'error.main' : 'inherit'}>{insights.lossMakers}</Typography>
            <Typography variant="caption" color="text.secondary">losing money at list price</Typography>
          </Grid>
        </Grid>

        {insights.underPriced.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" mb={1}>
              Priced below the {insights.target}% target — a suggestion, not an applied change
            </Typography>
            <Table size="small" aria-label="Products priced below the target margin">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell align="right">Margin</TableCell>
                  <TableCell align="right">Price for {insights.target}%</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {insights.underPriced.slice(0, 8).map(u => (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell align="right">P{u.price}</TableCell>
                    <TableCell align="right">P{u.cost}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color={u.margin < 0 ? 'error.main' : 'warning.main'}>{u.margin}%</Typography>
                    </TableCell>
                    <TableCell align="right">P{u.suggested}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {insights.underPriced.length > 8 && (
              <Typography variant="caption" color="text.secondary">
                …and {insights.underPriced.length - 8} more
              </Typography>
            )}
          </Box>
        ) : coverage.costed > 0 ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Every costed product clears the {insights.target}% target.
          </Alert>
        ) : null}

        {insights.categories.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" mb={1}>Margin by category</Typography>
            <Table size="small" aria-label="Margin by category">
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Costed</TableCell>
                  <TableCell align="right">Margin</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {insights.categories.slice(0, 10).map(c => (
                  <TableRow key={c.category}>
                    <TableCell>{c.category}</TableCell>
                    <TableCell align="right">{c.costed}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color={c.margin === null ? 'text.secondary' : c.margin < 0 ? 'error.main' : c.margin < 20 ? 'warning.main' : 'success.main'}>
                        {c.margin === null ? '—' : `${Math.round(c.margin)}%`}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {costHistory.length > 0 && (
          <Box>
            <Typography variant="subtitle2" mb={1}>Recent cost changes</Typography>
            <Box component="ul" sx={{ mt: 0, mb: 0, pl: 2 }}>
              {costHistory.map((h, i) => (
                <li key={i}>
                  {/* audit() spreads the payload at the TOP level of the entry,
                      not under `details` — reading h.details here showed a
                      permanent "0 set, 0 cleared". */}
                  {Array.isArray(h.products) && h.products.length === 1
                    ? h.products[0]
                    : `${h.updated || 0} set, ${h.cleared || 0} cleared`}
                  {Array.isArray(h.products) && h.products.length > 1 && (
                    <Typography variant="caption" color="text.secondary">
                      {' '}— {h.products.slice(0, 3).join(', ')}{h.products.length > 3 ? ` +${h.products.length - 3} more` : ''}
                    </Typography>
                  )}
                  {' · '}{h.actor || 'someone'}{' · '}{new Date(h.t).toLocaleString()}
                </li>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
              Read from the durable audit trail, so it survives a redeploy.
            </Typography>
          </Box>
        )}
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
            {costDiff.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <strong>What this will change:</strong>
                <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2, maxHeight: 180, overflowY: 'auto' }}>
                  {costDiff.map(d => (
                    <li key={`${d.id}-${d.status}`}>
                      {d.name}: {d.from === null ? 'not costed' : `P${d.from}`} → {d.to === null ? 'not costed' : `P${d.to}`}
                      {d.status === 'unchanged' ? ' (no change)' : ''}
                    </li>
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
          <Box sx={{ flex: 1, minWidth: 260 }}>
            <Typography variant="h6">Active products</Typography>
            {/* The work queue. After a bulk apply this used to be the only
                feedback available: "Total 204", with no indication of how many
                were left or which ones. */}
            <Typography variant="body2" color="text.secondary">
              {coverage.costed} of {coverage.total} costed ({coverage.pct}%)
              {coverage.uncosted > 0 ? ` · ${coverage.uncosted} still to cost` : ' · fully costed'}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={coverage.pct}
              color={coverage.pct === 100 ? 'success' : 'primary'}
              sx={{ mt: 1, height: 6, borderRadius: 3, maxWidth: 420 }}
            />
          </Box>
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
            <Typography variant="body2" color="text.secondary">Showing {prodList.length}</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'uncosted', label: 'Not costed' },
            { key: 'loss', label: 'Cost ≥ price' },
            { key: 'thin', label: 'Margin under 20%' },
          ].map(chip => (
            <Chip
              key={chip.key}
              label={`${chip.label} (${bucketCounts[chip.key]})`}
              onClick={() => setBucket(chip.key)}
              color={bucket === chip.key ? 'primary' : 'default'}
              variant={bucket === chip.key ? 'filled' : 'outlined'}
              size="small"
            />
          ))}
          <Button size="small" variant="text" onClick={copyUncosted} disabled={coverage.uncosted === 0}>
            Copy uncosted names
          </Button>
        </Box>
        <Table aria-label="Active products">
          <TableHead>
            <TableRow>
              <TableCell>Photo</TableCell>
              <TableCell sortDirection={sort.key === 'name' ? sort.dir : false}>
                <TableSortLabel active={sort.key === 'name'} direction={sort.dir} onClick={() => toggleSort('name')}>Name</TableSortLabel>
              </TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Unit Measurement</TableCell>
              <TableCell sortDirection={sort.key === 'price' ? sort.dir : false}>
                <TableSortLabel active={sort.key === 'price'} direction={sort.dir} onClick={() => toggleSort('price')}>Price</TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sort.key === 'cost' ? sort.dir : false}>
                <TableSortLabel active={sort.key === 'cost'} direction={sort.dir} onClick={() => toggleSort('cost')}>Cost</TableSortLabel>
              </TableCell>
              <TableCell sortDirection={sort.key === 'margin' ? sort.dir : false}>
                <TableSortLabel active={sort.key === 'margin'} direction={sort.dir} onClick={() => toggleSort('margin')}>Margin</TableSortLabel>
              </TableCell>
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
                    separate cost sheet rather than the public catalog.
                    The Cost cell edits in place: click, type, Enter. It saves
                    through the single-row bulk-costs call, which touches only
                    this column — unlike the product PUT, which full-replaces
                    every column and would wipe the cost if a field were
                    missed. */}
                <TableCell sx={{ width: 130 }}>
                  {editingCostId === product.id ? (
                    <TextField
                      autoFocus
                      size="small"
                      value={editingCostValue}
                      disabled={costBusyId === product.id}
                      onChange={e => setEditingCostValue(sanitizePrice(e.target.value))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveInlineCost(product, editingCostValue);
                        if (e.key === 'Escape') setEditingCostId(null);
                      }}
                      onBlur={e => saveInlineCost(product, e.target.value)}
                      placeholder="not costed"
                      inputProps={{ 'aria-label': `Cost of goods for ${product.name}` }}
                    />
                  ) : (
                    <Tooltip title="Click to edit this product's cost">
                      <Box
                        component="button"
                        type="button"
                        onClick={() => { setEditingCostId(product.id); setEditingCostValue(product.cost === null || product.cost === undefined ? '' : String(product.cost)); }}
                        sx={{
                          background: 'none', border: '1px dashed transparent', borderRadius: 1,
                          cursor: 'pointer', font: 'inherit', px: 1, py: 0.5, width: '100%',
                          textAlign: 'left', color: product.cost === null || product.cost === undefined ? 'text.secondary' : 'text.primary',
                        }}
                      >
                        {product.cost === null || product.cost === undefined ? (
                          <Typography variant="caption" color="text.secondary">not costed</Typography>
                        ) : `P${product.cost}`}
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  {(() => {
                    const bucket = marginBucket(product);
                    if (bucket === 'uncosted') return <Typography variant="caption" color="text.secondary">—</Typography>;
                    const pct = Math.round(marginPercentOf(product));
                    const color = bucket === 'loss' ? 'error' : bucket === 'thin' ? 'warning' : 'success';
                    return <Typography variant="body2" color={`${color}.main`}>{pct}%</Typography>;
                  })()}
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

import { Snackbar } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, bulkUpdatePrices, bulkUpdateCosts, getCurrentUser } from '../../api';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';
import { parseQrPayload } from '../../qr';
import { parseCostSheet, toCostPayload, summarizeCostSheet, buildCostTemplate, sheetDiff, coverageOf, marginBucket, marginPercentOf, buildCostInsights, buildRepricePlan } from '../../cost-sheet';
import { summarizeNormalization, buildRateSheet, DIMENSION_LABEL } from '../../cost-normalize';
import ProductFormPanel from './ProductFormPanel';
import BulkSheetPanel from './BulkSheetPanel';
import MarginOverviewPanel from './MarginOverviewPanel';
import ProductsTablePanel from './ProductsTablePanel';
import { parseCsvRows, downloadCsv, priceTemplateCsv } from './products-csv';

// The create/edit form's empty shape, in ONE place so create, cancel-edit and
// clear all reset to the same thing.
const EMPTY_FORM = { name: '', category: '', brand: '', description: '', size: '', unit: '', price: '', cost: '', image: '' };

// Container for the Products module: it owns all state, the API calls and the
// derived data, and composes the presentational panels (form, bulk sheets,
// margin overview, table) that were split out of this file. The panels are
// deliberately dumb — they render props and raise intent.
export default function ProductsPage({ onLogout }) {
  usePageTitle('/products');
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
  // One-click reprice. The plan is built and shown BEFORE anything is sent, so
  // the dialog is confirming a specific, already-computed list rather than
  // asking the user to trust a button.
  const [repriceOpen, setRepriceOpen] = useState(false);
  const [repricePlan, setRepricePlan] = useState(null);
  const [repriceBusy, setRepriceBusy] = useState(false);
  // One panel, two sheets. The state for each column is still separate, because
  // the SEMANTICS are: a blank price is junk, a blank cost means leave it
  // alone (see cost-sheet.js). Only the chrome is shared.
  const [sheetMode, setSheetMode] = useState('cost');

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

  // Scan-to-stock: decode a pasted/scanned product tag payload and jump to the
  // matching screen. A product tag opens Scan & Stock pre-loaded with that
  // product; a location tag opens the inventory view filtered to that area.
  const handleScanSubmit = () => {
    const raw = scanValue.trim();
    const parsed = parseQrPayload(raw);
    if (!parsed) {
      setSnackbar({ open: true, message: "Not a supported Sylver tag. Current printed tags use INVENTRAK:PROD:<id> or INVENTRAK:LOC:<id>:<name>.", severity: 'warning' });
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
  // Supplier-rate costing: how the catalog splits by size dimension, and the
  // one rate the admin has from the supplier.
  const normalization = useMemo(() => summarizeNormalization(products), [products]);
  const [rateDimension, setRateDimension] = useState('volume');
  const [rate, setRate] = useState('');
  // The size text is copied straight into the cost sheet's text box, so the
  // generated sheet is previewed, parsed and applied through exactly the same
  // path as a pasted CSV — one parser, one set of rules, no second code path to
  // keep honest.
  const loadRateSheet = () => {
    const built = buildRateSheet(products, { dimension: rateDimension, rate });
    setCostText(built.csv);
    setCostRows([]);
    setCostSummary(null);
    setCostDiff([]);
    runCostPreview(built.csv);
    setSnackbar({
      open: true,
      message: built.priced > 0
        ? `Generated ${built.priced} cost(s) from the ${DIMENSION_LABEL[rateDimension]} rate — review the preview, then apply`
        : 'That rate produced no costs — check the number, or pick a different dimension.',
      severity: built.priced > 0 ? 'success' : 'warning',
    });
  };

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
        setForm(EMPTY_FORM);
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
      setForm(EMPTY_FORM);
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // --- Bulk price-list helpers ---

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
  const downloadPriceTemplate = () => downloadCsv('inventrak-prices.csv', priceTemplateCsv(products));

  const handleBulkFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBulkText(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- One-click reprice ---
  //
  // The under-priced table already computes the price each product would need.
  // Making the admin copy it into the price sheet by hand threw that work away.
  // The write goes through the SAME audited endpoint as the bulk sheet, and is
  // always confirmed first: a bulk reprice rewrites the number every margin,
  // quote and profit figure is derived from.
  const askReprice = (rows) => {
    const plan = buildRepricePlan(rows);
    if (plan.prices.length === 0) {
      setSnackbar({ open: true, message: 'Nothing to reprice — every suggestion is already at or above the target.', severity: 'info' });
      return;
    }
    setRepricePlan(plan);
    setRepriceOpen(true);
  };

  const applyReprice = async() => {
    if (!repricePlan || !repricePlan.prices.length) return;
    setRepriceBusy(true);
    try {
      const res = await bulkUpdatePrices({ prices: repricePlan.prices.map(r => ({ name: r.name, price: r.price })) });
      setRepriceOpen(false);
      setSnackbar({
        open: true,
        message: `Repriced ${res.updated} of ${res.total} product${res.total === 1 ? '' : 's'} to the ${insights.target}% target`,
        severity: res.updated > 0 ? 'success' : 'warning',
      });
      loadProducts();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setRepriceBusy(false);
      setRepricePlan(null);
    }
  };

  // --- Bulk cost-of-goods helpers ---

  // Downloads the current cost sheet, with the selling price alongside the cost
  // so the margin is visible while typing. Uncosted products export a BLANK
  // cost cell, which re-imports as "leave alone" rather than "clear" — the
  // round trip is therefore lossless (see cost-sheet.js).
  const downloadCostTemplate = () => downloadCsv('inventrak-costs.csv', buildCostTemplate(products));

  // `textOverride` exists because setCostText() is ASYNC: a caller that fills
  // the box and immediately previews (the supplier-rate helper) would otherwise
  // parse the PREVIOUS value — the empty string — and report "no parseable
  // rows" while looking like it had worked. Passing the text through makes the
  // preview independent of when React gets round to the state update.
  const runCostPreview = (textOverride) => {
    const source = textOverride === undefined ? costText : textOverride;
    const rows = parseCostSheet(source);
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
      <ProductFormPanel
        form={form}
        setForm={setForm}
        saving={saving}
        editingProductId={editingProductId}
        categoryOptions={categoryOptions}
        brandOptions={brandOptions}
        unitOptions={unitOptions}
        onSave={handleCreate}
        onCancel={() => { setEditingProductId(null); setForm(EMPTY_FORM); }}
        formRef={formRef}
      />

      <BulkSheetPanel
        sheetMode={sheetMode}
        onSheetMode={setSheetMode}
        onDownloadPrice={downloadPriceTemplate}
        onDownloadCost={downloadCostTemplate}
        normalization={normalization}
        rateDimension={rateDimension}
        onRateDimension={setRateDimension}
        rate={rate}
        onRate={setRate}
        onLoadRateSheet={loadRateSheet}
        costText={costText}
        onCostText={setCostText}
        costRows={costRows}
        costSummary={costSummary}
        costResult={costResult}
        costBusy={costBusy}
        costDiff={costDiff}
        costFileRef={costFileRef}
        onCostFile={handleCostFile}
        onCostPreview={runCostPreview}
        onApplyCost={applyCostSheet}
        bulkText={bulkText}
        onBulkText={setBulkText}
        bulkRows={bulkRows}
        bulkPreview={bulkPreview}
        bulkResult={bulkResult}
        bulkBusy={bulkBusy}
        fileInputRef={fileInputRef}
        onBulkFile={handleBulkFile}
        onBulkPreview={runBulkPreview}
        onApplyPrices={applyBulkPrices}
      />

      <MarginOverviewPanel
        coverage={coverage}
        insights={insights}
        costHistory={costHistory}
        repriceBusy={repriceBusy}
        onReprice={askReprice}
        repriceOpen={repriceOpen}
        onRepriceOpenChange={setRepriceOpen}
        repricePlan={repricePlan}
        onApplyReprice={applyReprice}
      />

      <ProductsTablePanel
        coverage={coverage}
        prodList={prodList}
        loading={loading}
        sort={sort}
        onToggleSort={toggleSort}
        bucket={bucket}
        onBucket={setBucket}
        bucketCounts={bucketCounts}
        onCopyUncosted={copyUncosted}
        search={search}
        onSearch={setSearch}
        scanValue={scanValue}
        onScanValue={setScanValue}
        onScanSubmit={handleScanSubmit}
        onShowSheetChange={setShowSheet}
        editingCostId={editingCostId}
        onEditingCostIdChange={setEditingCostId}
        editingCostValue={editingCostValue}
        onEditingCostValueChange={setEditingCostValue}
        onSaveInlineCost={saveInlineCost}
        costBusyId={costBusyId}
        onEdit={handleEdit}
        activeTag={activeTag}
        onActiveTag={setActiveTag}
        singleTagRef={singleTagRef}
        showSheet={showSheet}
        confirmDelete={confirmDelete}
        onConfirmDelete={setConfirmDelete}
        onDelete={handleDelete}
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

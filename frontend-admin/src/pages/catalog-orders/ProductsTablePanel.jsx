import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Tooltip, Typography } from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { API_BASE_URL } from '../../api';
import { colors } from '../../theme';
import QrTagSheet from '../../components/QrTagSheet';
import QrImage from '../../components/QrImage';
import { printElement } from '../../printReport';
import { productQrPayload } from '../../qr';
import { marginBucket, marginPercentOf } from '../../cost-sheet';
import { sanitizePrice } from './products-csv';

// "Active products": the cost work queue (search + bucket chips), the sortable
// table with in-place cost editing, and the product tag / delete dialogs. All
// state stays in ProductsPage — this renders it and raises intent.
export default function ProductsTablePanel({
  coverage,
  prodList,
  loading,
  sort,
  onToggleSort,
  bucket,
  onBucket,
  bucketCounts,
  onCopyUncosted,
  search,
  onSearch,
  scanValue,
  onScanValue,
  onScanSubmit,
  onShowSheet,
  editingCostId,
  onEditingCostIdChange,
  editingCostValue,
  onEditingCostValueChange,
  onSaveInlineCost,
  costBusyId,
  onEdit,
  activeTag,
  onActiveTag,
  singleTagRef,
  showSheet,
  onShowSheetChange,
  confirmDelete,
  onConfirmDelete,
  onDelete,
}) {
  return (
    <>
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
            {/* Scan-to-stock: paste (or type) a supported QR payload and jump
                straight to that product's stock view. Accepts exactly what the
                phone's scanner emits, so an admin can verify a tag on the
                spot. */}
            <TextField
              size="small"
              label="Scan / paste QR tag"
              value={scanValue}
              onChange={e => onScanValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onScanSubmit(); }}
              sx={{ minWidth: 240, backgroundColor: colors.surface }}
              helperText="Current printed tag example: INVENTRAK:PROD:12 or a location tag"
            />
            <Button size="small" variant="outlined" onClick={onScanSubmit} disabled={!scanValue.trim()}>
              Go
            </Button>
            <TextField
              size="small"
              label="Search products…"
              value={search}
              onChange={e => onSearch(e.target.value)}
              sx={{ minWidth: 240, backgroundColor: colors.surface }}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={() => onShowSheetChange(true)}
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
              onClick={() => onBucket(chip.key)}
              color={bucket === chip.key ? 'primary' : 'default'}
              variant={bucket === chip.key ? 'filled' : 'outlined'}
              size="small"
            />
          ))}
          <Button size="small" variant="text" onClick={onCopyUncosted} disabled={coverage.uncosted === 0}>
            Copy uncosted names
          </Button>
        </Box>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table aria-label="Active products">
            <TableHead>
              <TableRow>
                <TableCell>Photo</TableCell>
                <TableCell sortDirection={sort.key === 'name' ? sort.dir : false}>
                  <TableSortLabel active={sort.key === 'name'} direction={sort.dir} onClick={() => onToggleSort('name')}>Name</TableSortLabel>
                </TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Unit Measurement</TableCell>
                <TableCell sortDirection={sort.key === 'price' ? sort.dir : false}>
                  <TableSortLabel active={sort.key === 'price'} direction={sort.dir} onClick={() => onToggleSort('price')}>Price</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sort.key === 'cost' ? sort.dir : false}>
                  <TableSortLabel active={sort.key === 'cost'} direction={sort.dir} onClick={() => onToggleSort('cost')}>Cost</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sort.key === 'margin' ? sort.dir : false}>
                  <TableSortLabel active={sort.key === 'margin'} direction={sort.dir} onClick={() => onToggleSort('margin')}>Margin</TableSortLabel>
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
                        onChange={e => onEditingCostValueChange(sanitizePrice(e.target.value))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') onSaveInlineCost(product, editingCostValue);
                          if (e.key === 'Escape') onEditingCostIdChange(null);
                        }}
                        onBlur={e => onSaveInlineCost(product, e.target.value)}
                        placeholder="not costed"
                        inputProps={{ 'aria-label': `Cost of goods for ${product.name}` }}
                      />
                    ) : (
                      <Tooltip title="Click to edit this product's cost">
                        <Box
                          component="button"
                          type="button"
                          onClick={() => { onEditingCostIdChange(product.id); onEditingCostValueChange(product.cost === null || product.cost === undefined ? '' : String(product.cost)); }}
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
                      const b = marginBucket(product);
                      if (b === 'uncosted') return <Typography variant="caption" color="text.secondary">—</Typography>;
                      const pct = Math.round(marginPercentOf(product));
                      const color = b === 'loss' ? 'error' : b === 'thin' ? 'warning' : 'success';
                      return <Typography variant="body2" color={`${color}.main`}>{pct}%</Typography>;
                    })()}
                  </TableCell>
                  <TableCell>{product.brand}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button size="small" variant="outlined" onClick={() => onEdit(product)}>Edit</Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<QrCode2Icon />}
                        aria-label={`Show QR tag for ${product.name}`}
                        onClick={() => onActiveTag(product)}
                      >
                        QR
                      </Button>
                      <Button size="small" variant="contained" color="error" onClick={() => onConfirmDelete(product.id)}>Delete</Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={confirmDelete !== null} onClose={() => onConfirmDelete(null)}>
        <DialogTitle>Delete this product? This action cannot be undone.</DialogTitle>
        <DialogActions>
          <Button onClick={() => onConfirmDelete(null)}>Cancel</Button>
          <Button onClick={onDelete} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Single product tag: printable on its own, and the payload shown so it
          can be verified/matched against the mobile scanner. */}
      <Dialog open={Boolean(activeTag)} onClose={() => onActiveTag(null)}>
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
                page. Sylver's apps resolve it to the product's stock view.
                Old plain-payload tags (INVENTRAK:PROD:id) still scan in the
                apps; reprint to get camera-friendly tags.
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onActiveTag(null)}>Close</Button>
          <Button variant="contained" color="secondary" onClick={() => printElement(singleTagRef.current)} disabled={!activeTag}>
            🖨 Print tag
          </Button>
        </DialogActions>
      </Dialog>

      {/* Batch sheet: every active product tag on one print-friendly page. */}
      <QrTagSheet
        open={showSheet}
        onClose={() => onShowSheetChange(false)}
        locations={[]}
        products={prodList}
      />
    </>
  );
}

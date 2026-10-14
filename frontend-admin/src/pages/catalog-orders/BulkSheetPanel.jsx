import { Alert, AlertTitle, Box, Button, ButtonGroup, Grid, Paper, TextField, Typography } from '@mui/material';
import { colors } from '../../theme';
import FormulaBanner from '../../components/FormulaBanner';
import { DIMENSION_LABEL } from '../../cost-normalize';
import { sanitizePrice } from './products-csv';

// One panel, two sheets. Prices and costs used to be two near-identical panels
// separated by the margin overview, which read as two features when they are
// the same gesture on two columns. The SEMANTICS stay separate — a blank price
// is junk, a blank cost means "leave it alone" (see cost-sheet.js) — but the
// chrome is shared. Extracted from ProductsPage; state + the API calls live in
// the page, this renders the panel and raises the user's intent.
export default function BulkSheetPanel({
  sheetMode,
  onSheetMode,
  onDownloadPrice,
  onDownloadCost,
  normalization,
  rateDimension,
  onRateDimension,
  rate,
  onRate,
  onLoadRateSheet,
  // Cost column
  costText,
  onCostText,
  costRows,
  costSummary,
  costResult,
  costBusy,
  costDiff,
  costFileRef,
  onCostFile,
  onCostPreview,
  onApplyCost,
  // Price column
  bulkText,
  onBulkText,
  bulkRows,
  bulkPreview,
  bulkResult,
  bulkBusy,
  fileInputRef,
  onBulkFile,
  onBulkPreview,
  onApplyPrices,
}) {
  return (
    <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Typography variant="h6">Bulk sheet</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <ButtonGroup size="small" variant="outlined" aria-label="Choose which column this sheet sets">
            {[
              { key: 'cost', label: 'Cost of goods' },
              { key: 'price', label: 'Prices' },
            ].map(t => (
              <Button
                key={t.key}
                onClick={() => onSheetMode(t.key)}
                variant={sheetMode === t.key ? 'contained' : 'outlined'}
              >
                {t.label}
              </Button>
            ))}
          </ButtonGroup>
          <Button size="small" variant="outlined" onClick={sheetMode === 'cost' ? onDownloadCost : onDownloadPrice}>
            {sheetMode === 'cost' ? 'Download current costs (CSV)' : 'Download current prices (CSV)'}
          </Button>
        </Box>
      </Box>

      {sheetMode === 'cost' ? (
        <>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Paste or upload a <code>Product Name,Cost</code> sheet to cost the whole catalog in one go
            (a <code>Product Name,Price,Cost</code> sheet works too — the exported template is that shape).
            A <strong>blank cost cell leaves that product alone</strong>; type <code>-</code> or <code>clear</code> to
            deliberately mark one as not costed. Costing a query is what makes the margin figures on
            Costing Records real — an uncosted product reports <code>cost_basis: &quot;none&quot;</code> rather than a guess.
          </Typography>

          {normalization.dimensions.length > 0 && (
            <Box sx={{ mb: 2, p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
              <FormulaBanner
                dense
                title="Cost math on this panel"
                items={[
                  'blank cost cell  -> LEAVE ALONE          (never "clear" — that would wipe 200 real costs)',
                  '"-" or "clear"   -> set cost to NULL      (deliberate "not costed")',
                  'anything else    -> set cost to that number',
                  'rateSheet cost   = (rate / basis) * packSize      // basis = 100 ml | 100 g | 1 piece',
                  'unreadable size  -> blank cell           (a guess would fabricate a cost, so it declines)',
                ]}
                note="The panel, the CLI script and the server share one rule — see backend/src/costing.js. kg and L are both 1000, so every unit factor carries its dimension, not just its multiplier."
              />
              <Typography variant="subtitle2" mb={0.5} sx={{ mt: 1.5 }}>Or: one supplier rate instead of 200 numbers</Typography>
              <Typography variant="body2" color="text.secondary" mb={1.5}>
                Suppliers quote syrup per litre and chocolate per kilo, not per bottle. Type the rate once and the
                sheet below fills itself in.
                {normalization.unreadable.length > 0 && (
                  <> {normalization.unreadable.length} product(s) have no size recorded, so they stay blank and are
                    left alone — add a size to the product to include them.</>
                )}
              </Typography>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={5}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Rate is quoted"
                    value={rateDimension}
                    onChange={e => onRateDimension(e.target.value)}
                    helperText={normalization.dimensions.find(d => d.dimension === rateDimension)
                      ? `${normalization.dimensions.find(d => d.dimension === rateDimension).count} product(s) match`
                      : 'no products in this dimension'}
                  >
                    {normalization.dimensions.map(d => (
                      <option key={d.dimension} value={d.dimension}>{`${DIMENSION_LABEL[d.dimension]} — ${d.count} product(s)`}</option>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    label={`Cost ${DIMENSION_LABEL[rateDimension] || ''}`}
                    value={rate}
                    onChange={e => onRate(sanitizePrice(e.target.value))}
                    placeholder="e.g. 45"
                    helperText="Blank = nothing generated"
                  />
                </Grid>
                <Grid item xs={12} sm={3} sx={{ display: 'flex', alignItems: 'flex-start' }}>
                  <Button variant="outlined" onClick={onLoadRateSheet} disabled={rate.trim() === ''}>
                    Fill the sheet
                  </Button>
                </Grid>
              </Grid>
            </Box>
          )}

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={6}
                variant="outlined"
                placeholder={'Almond Roca,380\nBlueberry,295\nCaramel Syrup (750 ML) - Torani,-'}
                value={costText}
                onChange={e => onCostText(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button variant="contained" component="label">
                Upload .csv
                <input type="file" accept=".csv,text/csv,text/plain" hidden ref={costFileRef} onChange={onCostFile} />
              </Button>
              {/* Wrapped, not passed by reference: the preview's first argument
                  is the text to parse, so handing it the click event would
                  parse String(event) and always report "no parseable rows". */}
              <Button variant="outlined" onClick={() => onCostPreview()} disabled={!costText.trim()}>Parse preview</Button>
              <Button variant="contained" color="success" onClick={onApplyCost} disabled={costBusy || !costRows.length}>
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
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Paste a price list or upload a .csv file to set all prices in one go.
            Format: <code>Product Name,Price</code> per line (header row optional).
            Every price you change here is named in the audit trail.
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
                onChange={e => onBulkText(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button variant="contained" component="label">
                Upload .csv
                <input type="file" accept=".csv,text/csv,text/plain" hidden ref={fileInputRef} onChange={onBulkFile} />
              </Button>
              <Button variant="outlined" onClick={onBulkPreview} disabled={!bulkText.trim()}>Parse preview</Button>
              <Button variant="contained" color="success" onClick={onApplyPrices} disabled={bulkBusy || !bulkRows.length}>
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
        </>
      )}
    </Paper>
  );
}
